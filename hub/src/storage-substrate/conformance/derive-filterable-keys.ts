/**
 * derive-filterable-keys.ts — C3-R4a (M-Shape-Conformance), the renameMap-governor.
 *
 * Statically derives the set of substrate-FILTERABLE flat keys per kind from the
 * `substrate.list(KIND, {filter, sort})` / `.watch(KIND, {filter})` call-sites in
 * hub/src. This REPLACES the hand-curated bound: the drift-gate
 * (filterable-keys-drift-gate.test.ts) asserts the committed
 * SUBSTRATE_FILTERABLE_KEYS equals this derivation, so a NEW filter on a
 * partition-relocated field can never silently skip its renameMap entry — the
 * bug-138 / bug-170 silent-filter-miss class.
 *
 * Keys that cannot be enumerated statically (a spread `...x`, a computed
 * `[expr]` key, an unresolved filter variable, or an unresolved kind argument)
 * are NOT silently dropped — they are returned as `dynamicSites` so the
 * drift-gate forces an explicit manual annotation (design: "the scanner FLAGS
 * dynamic/computed filter keys for manual annotation rather than silently
 * dropping them" — closing the static-scan false-negative).
 *
 * Construction note (C3-R4a): uses ts-morph (devDependency; bundles its own
 * TypeScript so it is independent of the repo's typescript ^6 — and dev-only, so
 * it never enters the prod image). Analysis is SAME-FILE (kind const + filter
 * var resolved within the call's own source file / function), which is
 * sufficient for the repo pattern (module-local `const KIND` + a function-local
 * `substrateFilter`) and avoids loading the full type-checker.
 */
import { Project, Node, SyntaxKind } from "ts-morph";
import type { SourceFile, Identifier, ObjectLiteralExpression } from "ts-morph";
import { join } from "node:path";

/** A filter/sort key that could not be enumerated statically — needs annotation. */
export interface DynamicSite {
  kind: string | null;
  reason: "spread" | "computed-key" | "unresolved-filter-var" | "unresolved-kind";
  file: string;
  line: number;
  detail: string;
}

export interface FilterableKeysScan {
  /** kind -> sorted unique statically-resolved flat filter/sort keys. */
  keys: Record<string, string[]>;
  /** call-sites whose keys cannot be enumerated statically (manual-annotation surface). */
  dynamicSites: DynamicSite[];
}

/** The substrate filter-bearing call methods (Filter rides opts.filter; sort rides opts.sort). */
const FILTER_METHODS = new Set(["list", "watch"]);

/**
 * Scan hub/src for substrate filter/sort call-sites and derive the filterable
 * keys per kind. `hubRoot` is the absolute path to the hub/ package dir.
 */
export function scanFilterableKeys(hubRoot: string): FilterableKeysScan {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    // No type-check needed — pure syntactic, same-file navigation.
    compilerOptions: { allowJs: false, noEmit: true },
  });
  project.addSourceFilesAtPaths(join(hubRoot, "src/**/*.ts"));

  const sourceFiles = project.getSourceFiles().filter((sf) => {
    const p = sf.getFilePath();
    return !p.includes("/__tests__/") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts");
  });

  const keys: Record<string, Set<string>> = {};
  const dynamicSites: DynamicSite[] = [];
  const addKey = (kind: string, key: string) => {
    (keys[kind] ??= new Set<string>()).add(key);
  };
  const flag = (s: DynamicSite) => dynamicSites.push(s);

  for (const sf of sourceFiles) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      if (!FILTER_METHODS.has(callee.getName())) continue;

      const args = call.getArguments();
      if (args.length < 2) continue; // need (kind, opts) — a 1-arg list has no filter
      const file = sf.getFilePath();
      const line = call.getStartLineNumber();

      // opts may be `{...}` OR `cond ? {...} : undefined` — collect the literal branches.
      const optsObjects = objectLiteralsOf(args[1]!);
      if (optsObjects.length === 0) {
        // opts is a parameter / call / non-literal that could still carry a filter:
        // FLAG rather than silently skip. A pure `undefined`/absent opts is not flagged.
        if (!isUndefinedish(args[1]!)) {
          const k = resolveKind(args[0]!, sf);
          flag({ kind: k, reason: "unresolved-filter-var", file, line, detail: `opts=${args[1]!.getText().slice(0, 60)}` });
        }
        continue;
      }
      const carriesFilter = optsObjects.some(
        (o) => o.getProperty("filter") || o.getProperty("sort") || o.getProperties().some((p) => Node.isSpreadAssignment(p)),
      );
      if (!carriesFilter) continue; // genuine non-filter list (e.g. `{ limit: 500 }`)

      const kind = resolveKind(args[0]!, sf);
      if (kind === null) {
        flag({ kind: null, reason: "unresolved-kind", file, line, detail: args[0]!.getText().slice(0, 80) });
        continue;
      }

      for (const opts of optsObjects) {
        // A spread in opts can hide `filter` (e.g. `...(envelopeFilter ? {filter} : {})`,
        // a helper-built/parametric filter) — can't resolve statically, so flag it.
        if (opts.getProperties().some((p) => Node.isSpreadAssignment(p))) {
          flag({ kind, reason: "spread", file, line, detail: `opts-spread (filter may be parametric): ${opts.getText().slice(0, 60)}` });
        }
        const filterProp = opts.getProperty("filter");
        if (filterProp && Node.isPropertyAssignment(filterProp)) {
          collectFilterKeys(filterProp.getInitializerOrThrow(), kind, file, addKey, flag);
        } else if (filterProp && Node.isShorthandPropertyAssignment(filterProp)) {
          // `{ filter }` — value is the in-scope `filter` (typically a parameter).
          collectFilterKeys(filterProp.getNameNode(), kind, file, addKey, flag);
        }
        const sortProp = opts.getProperty("sort");
        if (sortProp && Node.isPropertyAssignment(sortProp)) {
          collectSortFields(sortProp.getInitializerOrThrow(), kind, file, addKey, flag);
        } else if (sortProp && Node.isShorthandPropertyAssignment(sortProp)) {
          collectSortFields(sortProp.getNameNode(), kind, file, addKey, flag);
        }
      }
    }
  }

  const out: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(keys)) out[k] = [...set].sort();
  return { keys: out, dynamicSites };
}

/** Resolve the kind argument to a string literal value (direct or a same-file `const KIND = "X"`). */
function resolveKind(node: Node, sf: SourceFile): string | null {
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isIdentifier(node)) {
    const decl = sf
      .getVariableDeclarations()
      .find((d) => d.getName() === node.getText());
    const init = decl?.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
  }
  return null;
}

/** Collect flat filter keys from a `filter:` value (object literal, var, or ternary). */
function collectFilterKeys(
  value: Node,
  kind: string,
  file: string,
  addKey: (kind: string, key: string) => void,
  flag: (s: DynamicSite) => void,
): void {
  const node = unwrap(value);

  // `cond ? X : Y` (e.g. `keys.length>0 ? substrateFilter : undefined`)
  if (Node.isConditionalExpression(node)) {
    collectFilterKeys(node.getWhenTrue(), kind, file, addKey, flag);
    collectFilterKeys(node.getWhenFalse(), kind, file, addKey, flag);
    return;
  }
  // literal `undefined` / `null` — no keys.
  if (node.getKind() === SyntaxKind.UndefinedKeyword || node.getText() === "undefined" || Node.isNullLiteral(node)) {
    return;
  }
  if (Node.isObjectLiteralExpression(node)) {
    collectObjectKeys(node, kind, file, addKey, flag);
    return;
  }
  if (Node.isIdentifier(node)) {
    collectFromVar(node, kind, file, addKey, flag);
    return;
  }
  flag({ kind, reason: "unresolved-filter-var", file, line: node.getStartLineNumber(), detail: node.getText().slice(0, 80) });
}

/** Collect property-name keys from an object literal; flag spreads + computed names. */
function collectObjectKeys(
  obj: Node & { getProperties: () => Node[] },
  kind: string,
  file: string,
  addKey: (kind: string, key: string) => void,
  flag: (s: DynamicSite) => void,
): void {
  if (!Node.isObjectLiteralExpression(obj)) return;
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
      const nameNode = prop.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        addKey(kind, nameNode.getText());
      } else if (Node.isStringLiteral(nameNode)) {
        addKey(kind, nameNode.getLiteralValue());
      } else {
        // computed property name `[expr]`
        flag({ kind, reason: "computed-key", file, line: prop.getStartLineNumber(), detail: prop.getText().slice(0, 80) });
      }
    } else if (Node.isSpreadAssignment(prop)) {
      flag({ kind, reason: "spread", file, line: prop.getStartLineNumber(), detail: prop.getText().slice(0, 80) });
    }
  }
}

/** Resolve a function-local filter variable: its initializer + all `var.key = ` / `var["key"] = ` assignments. */
function collectFromVar(
  ident: Identifier,
  kind: string,
  file: string,
  addKey: (kind: string, key: string) => void,
  flag: (s: DynamicSite) => void,
): void {
  const name = ident.getText();
  const fn = ident.getFirstAncestor(
    (a) =>
      Node.isMethodDeclaration(a) ||
      Node.isFunctionDeclaration(a) ||
      Node.isArrowFunction(a) ||
      Node.isFunctionExpression(a),
  );
  const scope: Node = fn ?? ident.getSourceFile();

  // The declaration's initializer (object literal: `{}`, `{ shorthand }`, `{ ...spread }`).
  const decl = scope
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find((d) => d.getName() === name);
  if (!decl) {
    // Identifier is a parameter / import / outer binding — keys are caller-determined.
    flag({ kind, reason: "unresolved-filter-var", file, line: ident.getStartLineNumber(), detail: `filter var '${name}' is parametric (no local declaration)` });
    return;
  }
  const init = decl.getInitializer();
  if (init) collectFilterKeys(init, kind, file, addKey, flag);

  // Property/element assignments to the var within the scope: `name.key = ...` / `name["key"] = ...`.
  for (const bin of scope.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const lhs = bin.getLeft();
    if (Node.isPropertyAccessExpression(lhs) && lhs.getExpression().getText() === name) {
      addKey(kind, lhs.getName());
    } else if (Node.isElementAccessExpression(lhs) && lhs.getExpression().getText() === name) {
      const argExpr = lhs.getArgumentExpression();
      if (argExpr && Node.isStringLiteral(argExpr)) {
        addKey(kind, argExpr.getLiteralValue());
      } else {
        flag({ kind, reason: "computed-key", file, line: bin.getStartLineNumber(), detail: bin.getText().slice(0, 80) });
      }
    }
  }
}

/** Collect sort `field` values from a sort array literal (`[{ field: "x", order }]`). */
function collectSortFields(
  value: Node,
  kind: string,
  file: string,
  addKey: (kind: string, key: string) => void,
  flag: (s: DynamicSite) => void,
): void {
  const node = unwrap(value);
  if (!Node.isArrayLiteralExpression(node)) {
    // dynamic / variable sort spec — flag rather than drop.
    if (Node.isIdentifier(node)) {
      flag({ kind, reason: "unresolved-filter-var", file, line: node.getStartLineNumber(), detail: `sort:${node.getText()}` });
    }
    return;
  }
  for (const el of node.getElements()) {
    if (!Node.isObjectLiteralExpression(el)) continue;
    const fieldProp = el.getProperty("field");
    if (fieldProp && Node.isPropertyAssignment(fieldProp)) {
      const fv = fieldProp.getInitializerOrThrow();
      if (Node.isStringLiteral(fv)) addKey(kind, fv.getLiteralValue());
      else flag({ kind, reason: "computed-key", file, line: el.getStartLineNumber(), detail: `sort.field:${fv.getText().slice(0, 40)}` });
    }
  }
}

/** Strip parentheses / as-expressions to reach the underlying expression. */
function unwrap(node: Node): Node {
  let cur = node;
  while (Node.isParenthesizedExpression(cur) || Node.isAsExpression(cur) || Node.isSatisfiesExpression(cur)) {
    cur = cur.getExpression();
  }
  return cur;
}

/** Collect the object-literal branches of an opts node (unwrap `cond ? {..} : undefined`). */
function objectLiteralsOf(node: Node): ObjectLiteralExpression[] {
  const cur = unwrap(node);
  if (Node.isObjectLiteralExpression(cur)) return [cur];
  if (Node.isConditionalExpression(cur)) {
    return [...objectLiteralsOf(cur.getWhenTrue()), ...objectLiteralsOf(cur.getWhenFalse())];
  }
  return [];
}

/** True for a literal `undefined` / `null` node. */
function isUndefinedish(node: Node): boolean {
  const cur = unwrap(node);
  return cur.getText() === "undefined" || Node.isNullLiteral(cur) || cur.getKind() === SyntaxKind.UndefinedKeyword;
}
