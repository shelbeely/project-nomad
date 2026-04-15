
export const BROADCAST_CHANNELS = {
    BENCHMARK_PROGRESS: 'benchmark-progress',
    OLLAMA_MODEL_DOWNLOAD: 'ollama-model-download',
    SERVICE_INSTALLATION: 'service-installation',
    SERVICE_UPDATES: 'service-updates',
}

/** Returns the per-task SSE channel name for the AI Operator UI. */
export const operatorTaskChannel = (taskId: number | string) =>
    `operator/tasks/${taskId}`