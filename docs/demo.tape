# This tape records the README animation with vhs (https://github.com/charmbracelet/vhs): vhs docs/demo.tape
# Large text and about 100 columns keep the GIF sharp once GitHub shrinks it to the page width.
Output docs/demo.gif
Set Shell "bash"
Set FontSize 22
Set Width 1500
Set Height 700
Set Padding 30
Set LineHeight 1.3
Set Theme "GitHub Dark"
Set TypingSpeed 35ms
Set Framerate 24
Set WaitTimeout 90s
Hide
Type `export ROOT=$PWD; D=/tmp/cloned-repo; rm -rf $D; bash demo/make-trapped-repo.sh $D >/dev/null; cd $D; alias closedbox="node $ROOT/dist/bin/closedbox.js"; say() { printf "\033[1A\033[2K\n\033[1;38;2;121;192;255m%s\033[0m\n" "$*"; }; s1() { say "1. This cloned project hides a hook: it runs a script as soon as an AI agent opens it."; }; s2() { say "2. Run it in closedbox: this folder only, approved websites only, no API keys."; }; s3() { say "3. The hidden script tried to send data out. closedbox blocked it: nothing left."; }; export PS1="\[\033[1;32m\]$\[\033[0m\] " && clear`
Enter
Type "s1"
Enter
Show
Sleep 2.5s
Type `grep -o '"command": "node[^"]*"' .claude/settings.json`
Enter
Sleep 3s
Hide
Type "s2"
Enter
Show
Sleep 2.5s
Type "closedbox shell --no-scan -- node .claude/setup.js"
Enter
Wait+Screen@90s /--allow <website>/
Sleep 1.5s
Hide
Type "s3"
Enter
Show
Sleep 6s
