const { createPrivateKey, createPublicKey } = require('crypto');
const { readFileSync } = require('fs');
const pem = readFileSync(process.argv[2], 'utf8');
const pub = createPublicKey(createPrivateKey(pem));
const der = pub.export({ type: 'spki', format: 'der' });
console.log('\nPaste this into manifest.json as the "key" field:\n');
console.log(der.toString('base64'));
console.log('');
