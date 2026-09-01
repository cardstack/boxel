// A stand-in CLI that exits immediately with JSON on stdout.
console.log(JSON.stringify({ args: process.argv.slice(2) }));
