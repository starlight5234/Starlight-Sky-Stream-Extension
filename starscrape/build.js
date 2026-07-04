const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const files = ['tmdb.js', 'resolvers.js', 'main.js'];

let concatenated = '(function () {\n';

files.forEach(file => {
    const filePath = path.join(srcDir, file);
    if (fs.existsSync(filePath)) {
        concatenated += `\n// --- Start of ${file} ---\n`;
        concatenated += fs.readFileSync(filePath, 'utf8');
        concatenated += `\n// --- End of ${file} ---\n`;
    } else {
        console.error(`Error: Source file ${file} does not exist in ${srcDir}`);
        process.exit(1);
    }
});

concatenated += '\n})();\n';

const outputPath = path.join(__dirname, 'plugin.js');
fs.writeFileSync(outputPath, concatenated, 'utf8');
console.log(`Successfully compiled: ${outputPath}`);
