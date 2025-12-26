const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const JSON_FILE = 'pragmatic_play_wins.json';
const PARSER_SCRIPT = 'replay-parser.js';

async function main() {
    try {
        console.log(`Loading data from ${JSON_FILE}...`);

        if (!fs.existsSync(JSON_FILE)) {
            console.error(`Error: File ${JSON_FILE} not found.`);
            process.exit(1);
        }

        const data = fs.readFileSync(JSON_FILE, 'utf-8');
        const wins = JSON.parse(data);

        // Filter items that have a replayUrl
        const replays = wins.filter(w => w.replayUrl);

        console.log(`Found ${wins.length} total entries.`);
        console.log(`Found ${replays.length} entries with replay URLs to process.`);

        if (replays.length === 0) {
            console.log('No replays to process. Exiting.');
            return;
        }

        console.log('\n--- Starting Batch Recording ---\n');

        for (let i = 0; i < replays.length; i++) {
            const item = replays[i];
            const currentIndex = i + 1;
            const total = replays.length;

            // Generate expected safe filename prefix to check for existence
            const safeTitle = item.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

            // Check if any file in recordings dir starts with this safeTitle
            const recordingsDir = './recordings';
            let alreadyExists = false;

            if (fs.existsSync(recordingsDir)) {
                const files = fs.readdirSync(recordingsDir);
                alreadyExists = files.some(f => f.startsWith(safeTitle) && f.endsWith('.mp4'));
            }

            if (alreadyExists) {
                console.log(`\n[${currentIndex}/${total}] Skipping existing: ${item.title}`);
                continue;
            }

            console.log(`\n[${currentIndex}/${total}] Processing: ${item.title}`);
            console.log(`URL: ${item.replayUrl}`);

            try {
                // Execute the parser script synchronously
                // We forward stdio so we can see the parser's output
                execSync(`node ${PARSER_SCRIPT} "${item.replayUrl}"`, {
                    stdio: 'inherit',
                    encoding: 'utf-8'
                });

                console.log(`\n✅ Successfully processed: ${item.title}`);

            } catch (error) {
                console.error(`\n❌ Failed to process: ${item.title}`);
                console.error(`Error: ${error.message}`);
                // Continue to the next item even if this one failed
            }

            // Small delay between replays to be safe
            if (i < replays.length - 1) {
                console.log('Waiting 5 seconds before next replay...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        console.log('\n--- Batch Processing Complete ---');

    } catch (error) {
        console.error('Fatal Error:', error);
    }
}

main();
