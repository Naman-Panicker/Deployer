function getTimestamp(): string {
    return new Date().toISOString();
}

export type ErrorDetails = {
    step?: string | undefined;
    stack?: string | undefined;
    context?: Record<string, unknown> | undefined;
    cause?: unknown;
};

export const logger = {
    info: (service: string, message: string, meta?: Record<string, unknown>) => {
        const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
        console.log(`\x1b[36m[${getTimestamp()}]\x1b[0m \x1b[34m[${service}]\x1b[0m \x1b[32m[INFO]\x1b[0m ${message}${metaStr}`);
    },

    step: (service: string, id: string, stepNum: number, totalSteps: number, stepName: string, detail: string) => {
        console.log(
            `\x1b[36m[${getTimestamp()}]\x1b[0m \x1b[34m[${service}]\x1b[0m \x1b[35m[ID: ${id}]\x1b[0m \x1b[33m[STEP ${stepNum}/${totalSteps}: ${stepName}]\x1b[0m ➔ ${detail}`
        );
    },

    success: (service: string, message: string, id?: string) => {
        const idTag = id ? ` \x1b[35m[ID: ${id}]\x1b[0m` : '';
        console.log(`\x1b[36m[${getTimestamp()}]\x1b[0m \x1b[34m[${service}]\x1b[0m${idTag} \x1b[32m[SUCCESS]\x1b[0m ${message}`);
    },

    warn: (service: string, message: string, id?: string) => {
        const idTag = id ? ` \x1b[35m[ID: ${id}]\x1b[0m` : '';
        console.warn(`\x1b[36m[${getTimestamp()}]\x1b[0m \x1b[34m[${service}]\x1b[0m${idTag} \x1b[33m[WARN]\x1b[0m ${message}`);
    },

    error: (
        service: string,
        id: string | undefined,
        where: string,
        errorMessage: string,
        details?: ErrorDetails
    ) => {
        const idTag = id ? ` [ID: ${id}]` : '';
        const border = "═".repeat(70);
        console.error(`\x1b[31m\n╔${border}`);
        console.error(`║ [ERROR] [${service}]${idTag}`);
        console.error(`║ Timestamp : ${getTimestamp()}`);
        console.error(`║ Where     : ${where}`);
        if (details?.step) {
            console.error(`║ Step      : ${details.step}`);
        }
        console.error(`║ Message   : ${errorMessage}`);
        if (details?.context && Object.keys(details.context).length > 0) {
            console.error(`║ Context   : ${JSON.stringify(details.context, null, 2).replace(/\n/g, '\n║             ')}`);
        }
        if (details?.stack) {
            console.error(`║ Stack     :\n${details.stack.split('\n').map(l => `║   ${l}`).join('\n')}`);
        }
        console.error(`╚${border}\x1b[0m\n`);
    }
};
