let mediaRecorder;
let recordedChunks = [];
let startTime;
let timerInterval;

document.getElementById('startBtn').addEventListener('click', startRecording);
document.getElementById('stopBtn').addEventListener('click', stopRecording);

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: 'screen' },
      audio: false
    });
    
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    });
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      
      document.getElementById('preview').src = url;
      document.getElementById('preview').style.display = 'block';
      document.getElementById('downloadLink').href = url;
      document.getElementById('download').style.display = 'block';
      
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start(1000);
    
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.getElementById('status').textContent = '🔴 Recording...';
    
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    
  } catch (error) {
    alert('Recording failed: ' + error.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    clearInterval(timerInterval);
    
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('status').textContent = '✅ Recording complete!';
    document.getElementById('timer').textContent = '';
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('timer').textContent = `${minutes}:${seconds}`;
}
