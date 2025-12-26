const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SOURCE_DIR = './recordings';
const DEST_DIR = path.join(SOURCE_DIR, 'mp4');

async function compressVideos() {
    try {
        if (!fs.existsSync(SOURCE_DIR)) {
            console.error(`Source directory "${SOURCE_DIR}" does not exist.`);
            return;
        }

        if (!fs.existsSync(DEST_DIR)) {
            console.log(`Creating destination directory: ${DEST_DIR}`);
            fs.mkdirSync(DEST_DIR, { recursive: true });
        }

        const files = fs.readdirSync(SOURCE_DIR);
        // Process both .mp4 and .webm
        const videoFiles = files.filter(file => {
            return (file.endsWith('.mp4') || file.endsWith('.webm')) &&
                fs.statSync(path.join(SOURCE_DIR, file)).isFile();
        });

        if (videoFiles.length === 0) {
            console.log(`No video files found in "${SOURCE_DIR}".`);
            return;
        }

        console.log(`Found ${videoFiles.length} video files. Starting compression...\n`);

        for (const file of videoFiles) {
            const inputPath = path.join(SOURCE_DIR, file);
            // Ensure output is always .mp4
            const outputFilename = file.replace(/\.(webm|mp4)$/, '.mp4');
            const outputPath = path.join(DEST_DIR, outputFilename);

            // Avoid processing if input and output are the same path (shouldn't happen with subfolder)
            if (path.resolve(inputPath) === path.resolve(outputPath)) {
                console.log(`Skipping ${file} - input and output are same.`);
                continue;
            }

            console.log(`Compressing: ${file} -> mp4/${outputFilename}`);

            try {
                // Compression settings:
                // -crf 28: Good compression (standard is 23, higher is smaller file/lower quality)
                // -preset slow: Better compression per bitrate
                // -c:a aac -b:a 128k: Compress audio slightly
                const command = `ffmpeg -y -i "${inputPath}" -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;

                execSync(command, { stdio: 'inherit' });

                console.log(`✅ Compressed: ${outputFilename}\n`);

            } catch (err) {
                console.error(`❌ Failed to compress ${file}:`, err.message);
            }
        }

        console.log('All videos processed.');

    } catch (err) {
        console.error('Error:', err);
    }
}

compressVideos();
