#!/usr/bin/env python3
# hub-state.py — roller state-integrity helper (design 9548d827 §1.8, R6/T7/U3).
#
# ONE frozen durability primitive with TWO modes, exact per the frozen design:
#   COMMON temp write: os.open(tmp, O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW, 0o600) in the
#     SAME 0700 dir (the O_CREAT|O_EXCL|O_NOFOLLOW create — never a shell redirection —
#     IS the implementable no-follow + no-clobber) -> write-all loop (os.write may
#     short-write; loop until every byte is written; on ANY error close+unlink(tmp) &
#     fail) -> os.fsync(fd) -> os.close(fd).
#   REPLACE-STATE (lastGoodDigest, D_bad): os.replace(tmp, target) [same-dir atomic,
#     overwrite OK] -> fsync parent dir.
#   CREATE-ONCE RECEIPT (never clobber): os.link(tmp, target, follow_symlinks=False)
#     -> reject EEXIST -> os.unlink(tmp) -> fsync parent dir.
#
# State lives under STATE_DIR (persistent boot disk, /var/lib/hub-roller), 0600 files,
# 0700 dir. Reads validate lastGoodDigest/D_bad against ^<REG>@sha256:[0-9a-f]{64}$ and
# a {schema_version,...} envelope; anything else => ABSENT/corrupt (fail-closed, never a
# launch/rollback target). NO secret material is ever handled here.
#
# CLI (all state ops route through this one primitive so the roller/boot bash never
# does its own file writes):
#   get   lastgood|dbad            -> prints the validated ref on stdout, exit 0;
#                                     exit 3 if absent/corrupt (fail-closed), no stdout.
#   set   lastgood|dbad <REG@sha256:...>  -> replace-state write; exit 0.
#   clear dbad                     -> remove the quarantine file (idempotent); exit 0.
#   receipt <target-path>          -> create-once publish of JSON read from stdin;
#                                     exit 0; exit 4 if target exists (EEXIST), exit 5
#                                     on any other durability failure.
#   selfcheck                      -> print python identity (path/version) for the
#                                     §1.1/T5 receipt binding; exit 0.
import errno, json, os, re, sys

SCHEMA_VERSION = 1
STATE_DIR = os.environ.get("HUB_ROLLER_STATE_DIR", "/var/lib/hub-roller")
# Exact AR repo the roller is bound to (design §1.3 / prod observation receipt).
REG = os.environ.get(
    "HUB_ROLLER_REG",
    "australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub",
)
_DIGEST_RE = re.compile(r"^" + re.escape(REG) + r"@sha256:[0-9a-f]{64}$")
_STATE_FILES = {"lastgood": "lastGoodDigest.json", "dbad": "D_bad.json"}


def _fail(msg, code):
    sys.stderr.write("[hub-state] %s\n" % msg)
    sys.exit(code)


def _write_all(fd, data):
    view = memoryview(data)
    off = 0
    while off < len(view):
        off += os.write(fd, view[off:])


def _fsync_dir(dirpath):
    dfd = os.open(dirpath, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


def _temp_write(target, data):
    """COMMON temp write; returns the temp path (fsynced, closed). Same 0700 dir."""
    d = os.path.dirname(target)
    tmp = os.path.join(d, ".%s.tmp.%d" % (os.path.basename(target), os.getpid()))
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW
    fd = os.open(tmp, flags, 0o600)
    try:
        _write_all(fd, data)
        os.fsync(fd)
    except BaseException:
        try:
            os.close(fd)
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        raise
    os.close(fd)
    return tmp


def _replace_state(target, data):
    tmp = _temp_write(target, data)
    try:
        os.replace(tmp, target)  # same-dir atomic rename, overwrite OK
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    _fsync_dir(os.path.dirname(target))


def _create_once(target, data):
    tmp = _temp_write(target, data)
    try:
        os.link(tmp, target, follow_symlinks=False)  # no-clobber
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        if e.errno == errno.EEXIST:
            _fail("receipt target already exists (create-once): %s" % target, 4)
        _fail("receipt link failed: %s" % e, 5)
    os.unlink(tmp)
    _fsync_dir(os.path.dirname(target))


def _read_digest(kind):
    """Return a validated canonical ref, or None (absent/corrupt => fail-closed)."""
    path = os.path.join(STATE_DIR, _STATE_FILES[kind])
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return None
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(obj, dict) or obj.get("schema_version") != SCHEMA_VERSION:
        return None  # unknown/newer version => unreadable, never guessed
    ref = obj.get("digest")
    if not isinstance(ref, str) or not _DIGEST_RE.match(ref):
        return None  # corrupt/invalid => ABSENT, never a launch/rollback target
    return ref


def _set_digest(kind, ref):
    if not _DIGEST_RE.match(ref):
        _fail("refusing to persist non-canonical ref: %r" % ref, 2)
    path = os.path.join(STATE_DIR, _STATE_FILES[kind])
    body = json.dumps({"schema_version": SCHEMA_VERSION, "digest": ref}).encode("utf-8")
    _replace_state(path, body)


def main(argv):
    if not argv:
        _fail("usage: hub-state.py <get|set|clear|receipt|selfcheck> ...", 2)
    cmd = argv[0]
    if cmd == "selfcheck":
        print("python3 path=%s version=%s" % (sys.executable, sys.version.split()[0]))
        return 0
    if cmd == "get":
        if len(argv) != 2 or argv[1] not in _STATE_FILES:
            _fail("usage: hub-state.py get <lastgood|dbad>", 2)
        ref = _read_digest(argv[1])
        if ref is None:
            sys.exit(3)  # fail-closed: absent/corrupt, no stdout
        print(ref)
        return 0
    if cmd == "set":
        if len(argv) != 3 or argv[1] not in _STATE_FILES:
            _fail("usage: hub-state.py set <lastgood|dbad> <REG@sha256:...>", 2)
        _set_digest(argv[1], argv[2])
        return 0
    if cmd == "clear":
        if len(argv) != 2 or argv[1] != "dbad":
            _fail("usage: hub-state.py clear dbad", 2)
        try:
            os.unlink(os.path.join(STATE_DIR, _STATE_FILES["dbad"]))
        except OSError:
            pass  # idempotent
        return 0
    if cmd == "receipt":
        if len(argv) != 2:
            _fail("usage: hub-state.py receipt <target-path>   (JSON on stdin)", 2)
        data = sys.stdin.buffer.read()
        try:
            json.loads(data.decode("utf-8"))  # reject non-JSON before publishing
        except (ValueError, UnicodeDecodeError):
            _fail("receipt body is not valid JSON", 2)
        _create_once(argv[1], data)
        return 0
    _fail("unknown command: %s" % cmd, 2)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
