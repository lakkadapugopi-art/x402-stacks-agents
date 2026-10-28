#!/usr/bin/env node
'use strict';

const { main } = require('../lib/cli');

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`ERROR ${error.code || 'ERROR'} ${error.message}\n`);
  process.exitCode = 1;
});
