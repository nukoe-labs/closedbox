#!/usr/bin/env bash
# This script runs INSIDE the sandbox. Every probe tries to escape; it prints "blocked" when the escape fails
# (what we want) and "ESCAPED" when it succeeds. One positive control checks that allowed traffic still works.
set -u
TIMEOUT=6

# This function prints the result of one probe: the first argument is its name, the second the exit code of the escape.
report() {
  if [ "$2" -eq 0 ]; then
    echo "ESCAPED  $1"
  else
    echo "blocked  $1"
  fi
}

# This function succeeds only when the given text is empty, so that a found secret counts as an escape.
found() {
  [ -n "$1" ]
}

curl -sS -m "$TIMEOUT" -o /dev/null https://registry.npmjs.org/ && echo "control  allowed host reachable through the proxy" || echo "ESCAPED  control failed: the allowed host is not reachable"

curl -sS -m "$TIMEOUT" --noproxy '*' -o /dev/null https://1.1.1.1/ 2>/dev/null; report "direct TCP to 1.1.1.1:443, proxy bypassed" $?
timeout "$TIMEOUT" bash -c 'exec 3<>/dev/tcp/1.1.1.1/80' 2>/dev/null; report "raw socket from bash to 1.1.1.1:80" $?
curl -sS -m "$TIMEOUT" --noproxy '*' -6 -o /dev/null 'https://[2606:4700:4700::1111]/' 2>/dev/null; report "direct IPv6 to 2606:4700:4700::1111" $?
timeout "$TIMEOUT" bash -c 'exec 3<>/dev/tcp/2606:4700:4700::1111/443' 2>/dev/null; report "raw IPv6 socket" $?
ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; report "ICMP ping to 1.1.1.1" $?

getent hosts "exfil-$RANDOM.closedbox-canary.example.com" >/dev/null 2>&1; report "DNS exfiltration through the system resolver" $?
dig +time=2 +tries=1 @8.8.8.8 "exfil-$RANDOM.closedbox-canary.example.com" >/dev/null 2>&1 && dig +short +time=2 +tries=1 @8.8.8.8 example.com | grep -qE '^[0-9]+\.[0-9]+\.'; report "DNS exfiltration over UDP to 8.8.8.8" $?
dig +tcp +short +time=2 +tries=1 @1.1.1.1 example.com 2>/dev/null | grep -qE '^[0-9]+\.[0-9]+\.'; report "DNS over TCP to 1.1.1.1" $?
curl -sS -m "$TIMEOUT" -o /dev/null "https://dns.google/resolve?name=exfil.closedbox-canary.example.com" 2>/dev/null; report "DNS over HTTPS to dns.google" $?

curl -sS -m "$TIMEOUT" -f -o /dev/null https://example.com/ 2>/dev/null; report "proxy CONNECT to a host outside the allowlist" $?
curl -sS -m "$TIMEOUT" -f -o /dev/null http://example.com/ 2>/dev/null; report "proxy plain HTTP to a host outside the allowlist" $?
curl -sS -m "$TIMEOUT" -f -o /dev/null https://1.1.1.1/ 2>/dev/null; report "proxy CONNECT to an IP address" $?
curl -sS -m "$TIMEOUT" -f -o /dev/null http://169.254.169.254/latest/meta-data/ 2>/dev/null; report "cloud metadata endpoint 169.254.169.254" $?
curl -sS -m "$TIMEOUT" -f -o /dev/null https://host.docker.internal:22/ 2>/dev/null; report "host services through the proxy (host.docker.internal)" $?
curl -sS -m "$TIMEOUT" -f -o /dev/null --noproxy '*' http://host.docker.internal:2375/ 2>/dev/null; report "Docker API on the host, proxy bypassed" $?
curl -sS -m "$TIMEOUT" -f -o /dev/null -H "Host: example.com" https://registry.npmjs.org/ 2>/dev/null && curl -sS -m "$TIMEOUT" https://registry.npmjs.org/ -H "Host: example.com" 2>/dev/null | grep -qi "example domain"; report "Host header swap on an allowed tunnel" $?

found "$(find / -xdev -name 'closedbox-canary*' -not -path '/proc/*' 2>/dev/null | grep -v '^/workspace/' || true)"; report "read the canary file planted in the host home folder" $?
found "$(ls -A /home/node/.ssh /home/node/.aws /root/.ssh 2>/dev/null || true)"; report "read ~/.ssh or ~/.aws" $?
found "$(cat /workspace/.env 2>/dev/null || true)"; report "read the .env file of the project" $?
found "$(cat /workspace/config/id_rsa 2>/dev/null || true)"; report "read a private key inside the project" $?
found "$( (env; cat /proc/*/environ 2>/dev/null) | tr '\0' '\n' | grep -E 'REALCANARY|ghp_canary' || true)"; report "read the real API key or GitHub token in the environment" $?

[ -S /var/run/docker.sock ] || [ -S /run/docker.sock ] || [ -S /run/podman/podman.sock ]; report "Docker or Podman socket mounted" $?
grep -q '^CapEff:\s*0000000000000000' /proc/self/status; report "process holds Linux capabilities" $(( $? == 0 ? 1 : 0 ))
grep -q '^NoNewPrivs:\s*1' /proc/self/status; report "no_new_privs is off, so setuid programs could raise privileges" $(( $? == 0 ? 1 : 0 ))
sudo -n true 2>/dev/null; report "sudo" $?
su -c true root </dev/null 2>/dev/null; report "su root" $?
mount -t tmpfs none /mnt 2>/dev/null; report "mount a file system" $?
touch /etc/closedbox-write-test 2>/dev/null; report "write to /etc" $?
[ "$(id -u)" = "0" ]; report "running as root" $?
nsenter --target 1 --mount true 2>/dev/null; report "enter the namespaces of PID 1" $?
