import { exec, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "node:url";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildProject(id: string) {
    return new Promise((resolve) => {
        const child = exec(`cd ${path.join(__dirname, `output/${id}`)} && npm install && npm run build`)

        child.stdout?.on('data', function(data) {
            console.log('stdout: ' + data);
        });
        child.stderr?.on('data', function(data) {
            console.log('stderr: ' + data);
        });

        child.on('close', function(code) {
           resolve("")
        });

    })
}