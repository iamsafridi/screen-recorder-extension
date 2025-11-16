// Content script for BugCapture extension
// This script runs in the context of web pages and handles recording

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'ready' });
  }
  return true;
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (window.__mediaRecorder && window.__mediaRecorder.state !== 'inactive') {
    window.__mediaRecorder.stop();
  }
  if (window.__recordingStream) {
    window.__recordingStream.getTracks().forEach(track => track.stop());
  }
});
