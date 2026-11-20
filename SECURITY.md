# Security policy

## Reporting a sandbox escape or a leak

Please use [GitHub private vulnerability reporting](https://github.com/nukoe-labs/stillsuit/security/advisories/new).
Do not open a public issue. You will get an answer within 3 working days.

In scope, for example:

- a way for code inside the agent container to reach a host outside the allowlist, or to resolve or send DNS;
- a way to read a secret that stillsuit keeps outside (the real API key, a masked file, anything in the home folder);
- a way to make the proxy send a key to another host than the one it belongs to;
- a crafted repository that makes stillsuit start without its scan or with a widened allowlist without approval.

Please include the probe, as a line that could join [`test/escape/probes.sh`](test/escape/probes.sh).

## Out of scope

- Kernel exploits that escape any container (stillsuit is a container, not a virtual machine).
- Data sent to a host that you allowed yourself.

## Supported versions

Only the latest release receives fixes.
