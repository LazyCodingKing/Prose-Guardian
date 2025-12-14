/**
 * PASSIVE WATCHER WEB WORKER
 * Runs n-gram analysis in background thread
 */

// Import the PassiveWatcher class (Web Workers can import ES6 modules)
importScripts('./passive-watcher.js');

let watcherInstance = null;

// Message handler
self.onmessage = function (e) {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'init':
                // Initialize watcher with settings
                watcherInstance = new PassiveWatcher(data.settings);
                self.postMessage({ type: 'ready' });
                break;

            case 'analyzeMessage':
                // Analyze single message
                if (watcherInstance) {
                    watcherInstance.analyzeMessage(data.text);
                    self.postMessage({
                        type: 'messageAnalyzed',
                        stats: watcherInstance.getStats()
                    });
                }
                break;

            case 'analyzeBatch':
                // Analyze chat history
                if (watcherInstance) {
                    const results = watcherInstance.analyzeChatHistory(data.messages);
                    self.postMessage({
                        type: 'batchComplete',
                        results
                    });
                }
                break;

            case 'getOverusedPhrases':
                // Get current overused phrases
                if (watcherInstance) {
                    const phrases = watcherInstance.getOverusedPhrases(data.minScore);
                    self.postMessage({
                        type: 'overusedPhrases',
                        phrases
                    });
                }
                break;

            case 'getStats':
                // Get statistics
                if (watcherInstance) {
                    self.postMessage({
                        type: 'stats',
                        stats: watcherInstance.getStats()
                    });
                }
                break;

            case 'reset':
                // Reset tracking
                if (watcherInstance) {
                    watcherInstance.reset();
                    self.postMessage({ type: 'resetComplete' });
                }
                break;

            case 'updateSettings':
                // Update settings
                if (watcherInstance) {
                    Object.assign(watcherInstance.settings, data.settings);
                    self.postMessage({ type: 'settingsUpdated' });
                }
                break;

            default:
                console.warn('[PassiveWatcher Worker] Unknown message type:', type);
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message,
            stack: error.stack
        });
    }
};
