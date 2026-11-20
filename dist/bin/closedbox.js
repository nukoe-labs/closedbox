#!/usr/bin/env node
import { main } from "../cli.js";
const DEFAULT_ID = 1000;
const user = { uid: process.getuid?.() ?? DEFAULT_ID, gid: process.getgid?.() ?? DEFAULT_ID };
process.exitCode = await main(process.argv.slice(2), user);
