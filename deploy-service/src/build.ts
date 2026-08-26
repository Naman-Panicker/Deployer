import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildProject(id: string, onLog?: (line: string) => void) {
    return new Promise<void>((resolve, reject) => {
        const projectPath = path.join(__dirname, `output/${id}`);
        const command = `cd ${projectPath} && npm install && npm run build`;
        const startTime = Date.now();

        logger.info("DEPLOY-SERVICE", `Executing build process for deployment [${id}]`, {
            workingDirectory: projectPath,
            command
        });

        const child = exec(command);

        child.stdout?.on('data', function(data) {
            const str = data.toString();
            logger.buildLog(id, 'STDOUT', str);
            onLog?.(str);
        });

        child.stderr?.on('data', function(data) {
            const str = data.toString();
            logger.buildLog(id, 'STDERR', str);
            onLog?.(str);
        });

        child.on('close', function(code) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            if (code === 0) {
                logger.success("DEPLOY-SERVICE", `Project build completed successfully in ${duration}s (exit code: ${code})`, id);
                resolve();
            } else {
                const buildError = new Error(`Build failed with exit code ${code} after ${duration}s`);
                logger.error("DEPLOY-SERVICE", id, `buildProject (${command})`, `Build process failed with exit code ${code}`, {
                    step: "BUILDING",
                    context: {
                        exitCode: code,
                        durationSeconds: duration,
                        projectPath,
                    }
                });
                reject(buildError);
            }
        });

        child.on('error', function(err) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.error("DEPLOY-SERVICE", id, `child_process.exec (${command})`, `Failed to spawn build process: ${err.message}`, {
                step: "BUILDING",
                stack: err.stack,
                context: {
                    projectPath,
                    durationSeconds: duration,
                }
            });
            reject(err);
        });
    });
}