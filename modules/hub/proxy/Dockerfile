# nginx ingress proxy for the OIS Hub — Cloud Run service hub-api
# mission-86 M-Hub-Storage-Cloud-Deploy, Design §4.15
#
# Built into Artifact Registry as the hub-proxy image (by the Cloud Build
# inline-build trigger). The Cloud Run service is Terraform-managed (no
# Watchtower); rebuilt only when this image source changes.
#
# The Hub VM internal IP is injected at container start via the
# HUB_VM_INTERNAL_IP env var (set on the Cloud Run service by Terraform)
# and substituted into the config by the stock nginx template mechanism.
FROM nginx:alpine

# Restrict envsubst to our single placeholder so nginx's own runtime
# variables ($host, $remote_addr, $proxy_add_x_forwarded_for, ...) are
# left untouched.
ENV NGINX_ENVSUBST_FILTER=HUB_VM_INTERNAL_IP

COPY default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080
