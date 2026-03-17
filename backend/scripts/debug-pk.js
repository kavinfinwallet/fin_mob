require('dotenv').config();
console.log('--- Env Check ---');
const pk = process.env.FIREBASE_PRIVATE_KEY;
if (!pk) {
    console.log('FIREBASE_PRIVATE_KEY is MISSING!');
} else {
    console.log('PK length:', pk.length);
    console.log('Starts with quote:', pk.startsWith('"') || pk.startsWith("'"));
    console.log('Ends with quote:', pk.endsWith('"') || pk.endsWith("'"));
    
    const pkClean = pk.replace(/^['"]|['"]$/g, '');
    const formatted = pkClean.replace(/\\n/g, '\n');
    console.log('Cleaned length:', formatted.length);
    console.log('First 50 chars of cleaned:', formatted.substring(0, 50));
    console.log('Last 50 chars of cleaned:', formatted.substring(formatted.length - 50));
}
