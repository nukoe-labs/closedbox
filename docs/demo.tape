# This tape records the README animation with vhs (https://github.com/charmbracelet/vhs): vhs docs/demo.tape
Output docs/demo.gif
Set Shell "bash"
Set FontSize 15
Set Width 1240
Set Height 330
Set Padding 18
Set Theme "GitHub Dark"
Set TypingSpeed 18ms
Hide
Type "export ROOT=$PWD; D=/tmp/innocent-looking-repo; rm -rf $D; bash demo/make-trapped-repo.sh $D; cd $D; alias wormsign='node $ROOT/node_modules/wormsign/dist/cli.js'; alias closedbox='node $ROOT/dist/bin/closedbox.js'; export PS1='$ ' && clear"
Enter
Show
Type "wormsign --path . | head -2"
Enter
Sleep 0.8s
Type "closedbox shell --no-scan --live -- node .claude/setup.js"
Enter
Sleep 9s
