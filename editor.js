// Canvas and context
let canvas, ctx;
let img = new Image();
let isDrawing = false;
let currentTool = null; // No tool selected by default
let currentColor = '#ff0000';
let lineWidth = 3;
let startX, startY;
let annotations = [];
let currentAnnotation = null;
let scale = 1;
let displayWidth, displayHeight;

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  // Get image data from URL params
  const params = new URLSearchParams(window.location.search);
  const imageData = params.get('image');
  
  if (imageData) {
    img.onload = () => {
      // Calculate scale to fit screen while maintaining aspect ratio
      const container = document.getElementById('canvasContainer');
      const maxWidth = container.clientWidth - 40;
      const maxHeight = container.clientHeight - 40;
      
      const scaleX = maxWidth / img.width;
      const scaleY = maxHeight / img.height;
      scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
      
      displayWidth = img.width * scale;
      displayHeight = img.height * scale;
      
      // Set canvas to display size
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      
      // Set canvas style to prevent browser scaling
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      
      redraw();
    };
    img.src = imageData;
  }
  
  // Tool buttons
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      
      // Update cursor based on tool
      if (currentTool) {
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = 'default';
      }
    });
  });
  
  // Color picker
  document.getElementById('colorPicker').addEventListener('change', (e) => {
    currentColor = e.target.value;
  });
  
  // Size slider
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeLabel = document.getElementById('sizeLabel');
  sizeSlider.addEventListener('input', (e) => {
    lineWidth = parseInt(e.target.value);
    sizeLabel.textContent = lineWidth;
  });
  
  // Canvas events
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseUp);
  
  // Action buttons
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('saveBtn').addEventListener('click', saveAnnotated);
  document.getElementById('cancelBtn').addEventListener('click', () => window.close());
}

function handleMouseDown(e) {
  if (!currentTool) return; // No tool selected, do nothing
  
  const rect = canvas.getBoundingClientRect();
  startX = e.clientX - rect.left;
  startY = e.clientY - rect.top;
  isDrawing = true;
  
  if (currentTool === 'text') {
    addText(startX, startY);
    isDrawing = false;
  } else if (currentTool === 'pen') {
    currentAnnotation = {
      tool: 'pen',
      color: currentColor,
      width: lineWidth,
      points: [{ x: startX, y: startY }]
    };
  }
}

function handleMouseMove(e) {
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  if (currentTool === 'pen') {
    currentAnnotation.points.push({ x: currentX, y: currentY });
    redraw();
    drawPen(currentAnnotation);
  } else {
    // Preview for shapes
    redraw();
    drawPreview(startX, startY, currentX, currentY);
  }
}

function handleMouseUp(e) {
  if (!isDrawing) return;
  isDrawing = false;
  
  const rect = canvas.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;
  
  if (currentTool === 'pen') {
    annotations.push(currentAnnotation);
    currentAnnotation = null;
  } else if (currentTool !== 'text') {
    annotations.push({
      tool: currentTool,
      color: currentColor,
      width: lineWidth,
      startX,
      startY,
      endX,
      endY
    });
  }
  
  redraw();
}

function drawPreview(x1, y1, x2, y2) {
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  switch(currentTool) {
    case 'arrow':
      drawArrow(x1, y1, x2, y2);
      break;
    case 'rectangle':
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      break;
    case 'circle':
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      ctx.beginPath();
      ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
      ctx.stroke();
      break;
  }
}

function drawArrow(x1, y1, x2, y2) {
  const headLength = 15 + lineWidth * 2;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  
  // Draw line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  
  // Draw arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLength * Math.cos(angle - Math.PI / 6),
    y2 - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLength * Math.cos(angle + Math.PI / 6),
    y2 - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

function drawPen(annotation) {
  if (annotation.points.length < 2) return;
  
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
  
  for (let i = 1; i < annotation.points.length; i++) {
    ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
  }
  
  ctx.stroke();
}

function addText(x, y) {
  const text = prompt('Enter text:');
  if (!text) return;
  
  annotations.push({
    tool: 'text',
    color: currentColor,
    width: lineWidth,
    x,
    y,
    text
  });
  
  redraw();
}

function redraw() {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw original image scaled to fit
  ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
  
  // Draw all annotations
  annotations.forEach(annotation => {
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    switch(annotation.tool) {
      case 'arrow':
        drawArrow(annotation.startX, annotation.startY, annotation.endX, annotation.endY);
        break;
      case 'rectangle':
        ctx.strokeRect(
          annotation.startX,
          annotation.startY,
          annotation.endX - annotation.startX,
          annotation.endY - annotation.startY
        );
        break;
      case 'circle':
        const radius = Math.sqrt(
          Math.pow(annotation.endX - annotation.startX, 2) +
          Math.pow(annotation.endY - annotation.startY, 2)
        );
        ctx.beginPath();
        ctx.arc(annotation.startX, annotation.startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
        break;
      case 'pen':
        drawPen(annotation);
        break;
      case 'text':
        ctx.font = `${annotation.width * 8}px Arial`;
        ctx.fillText(annotation.text, annotation.x, annotation.y);
        break;
    }
  });
}

function undo() {
  if (annotations.length > 0) {
    annotations.pop();
    redraw();
  }
}

function clearAll() {
  if (confirm('Clear all annotations?')) {
    annotations = [];
    redraw();
  }
}

function saveAnnotated() {
  // Create a temporary canvas at original image size for export
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = img.width;
  exportCanvas.height = img.height;
  const exportCtx = exportCanvas.getContext('2d');
  
  // Draw original image at full size
  exportCtx.drawImage(img, 0, 0);
  
  // Scale annotations back to original size
  const scaleBack = img.width / displayWidth;
  
  annotations.forEach(annotation => {
    exportCtx.strokeStyle = annotation.color;
    exportCtx.fillStyle = annotation.color;
    exportCtx.lineWidth = annotation.width * scaleBack;
    exportCtx.lineCap = 'round';
    exportCtx.lineJoin = 'round';
    
    switch(annotation.tool) {
      case 'arrow':
        drawArrowOnContext(
          exportCtx,
          annotation.startX * scaleBack,
          annotation.startY * scaleBack,
          annotation.endX * scaleBack,
          annotation.endY * scaleBack,
          annotation.width * scaleBack
        );
        break;
      case 'rectangle':
        exportCtx.strokeRect(
          annotation.startX * scaleBack,
          annotation.startY * scaleBack,
          (annotation.endX - annotation.startX) * scaleBack,
          (annotation.endY - annotation.startY) * scaleBack
        );
        break;
      case 'circle':
        const radius = Math.sqrt(
          Math.pow(annotation.endX - annotation.startX, 2) +
          Math.pow(annotation.endY - annotation.startY, 2)
        ) * scaleBack;
        exportCtx.beginPath();
        exportCtx.arc(
          annotation.startX * scaleBack,
          annotation.startY * scaleBack,
          radius,
          0,
          2 * Math.PI
        );
        exportCtx.stroke();
        break;
      case 'pen':
        if (annotation.points.length < 2) break;
        exportCtx.beginPath();
        exportCtx.moveTo(
          annotation.points[0].x * scaleBack,
          annotation.points[0].y * scaleBack
        );
        for (let i = 1; i < annotation.points.length; i++) {
          exportCtx.lineTo(
            annotation.points[i].x * scaleBack,
            annotation.points[i].y * scaleBack
          );
        }
        exportCtx.stroke();
        break;
      case 'text':
        exportCtx.font = `${annotation.width * 8 * scaleBack}px Arial`;
        exportCtx.fillText(
          annotation.text,
          annotation.x * scaleBack,
          annotation.y * scaleBack
        );
        break;
    }
  });
  
  // Convert to blob
  exportCanvas.toBlob((blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.storage.local.set({
        annotatedImage: reader.result
      }, () => {
        window.close();
      });
    };
    reader.readAsDataURL(blob);
  }, 'image/png');
}

function drawArrowOnContext(context, x1, y1, x2, y2, width) {
  const headLength = 15 + width * 2;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(
    x2 - headLength * Math.cos(angle - Math.PI / 6),
    y2 - headLength * Math.sin(angle - Math.PI / 6)
  );
  context.moveTo(x2, y2);
  context.lineTo(
    x2 - headLength * Math.cos(angle + Math.PI / 6),
    y2 - headLength * Math.sin(angle + Math.PI / 6)
  );
  context.stroke();
}
