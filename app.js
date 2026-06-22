/* ========== CONFIG ========== */
const STORAGE_KEY = 'pdf-reader-state';

/* ========== STATE MANAGEMENT ========== */
let state = {
  page: 1,
  highlights: [],  // [{page, x, y, w, h, color}]
  pencilMarks: [],  // [{page, points: [{x, y}, ...], color, size}]
  textNotes: [],    // [{page, x, y, text, color}]
  notes: '',
  theme: 'day',
  dictionaryEnabled: true,
  zoom: 'fit'
};

let pdfDoc = null;
let currentSpeechUtterance = null;
let pdfScale = 1.5;
document.addEventListener("DOMContentLoaded", () => {
  
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
    // Your pdfjsLib code goes here
});
/* ========== LOAD/SAVE STATE ========== */
function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      state = { ...state, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error loading state:', e);
    }
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

window.addEventListener('beforeunload', () => saveState());

/* ========== DOM ELEMENTS ========== */
let canvas, ctx, notebookEl, dictPanel, highlightColorInput, copyToast;

function initDOMElements() {
  canvas = document.getElementById('pdf-canvas');
  ctx = canvas.getContext('2d');
  notebookEl = document.getElementById('notebook');
  dictPanel = document.getElementById('dictionary-panel');
  highlightColorInput = document.getElementById('highlight-color');
  copyToast = document.getElementById('copy-toast');
}

/* ========== PDF RENDERING ========== */
async function renderPage(pageNum) {
  if (!pdfDoc || pageNum < 1 || pageNum > pdfDoc.numPages) return;

  try {
    const page = await pdfDoc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    
    // Calculate scale based on zoom level
    let scale = pdfScale;
    
    if (state.zoom === 'fit') {
      // Fit to screen width
      const container = document.getElementById('canvas-wrapper');
      scale = (container.clientWidth - 40) / baseViewport.width;
    } else {
      // Use percentage zoom
      scale = (parseInt(state.zoom) / 100) * 1.5;
    }
    
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    // Draw highlights
    await drawHighlights(page, pageNum, viewport);
    
    // Draw pencil marks
    await drawPencilMarks(pageNum);
    
    // Draw text notes
    await drawTextNotes(pageNum);

    // Update state
    state.page = pageNum;
    updatePageInfo();
    saveState();
  } catch (e) {
    console.error('Error rendering page:', e);
  }
}

async function drawHighlights(page, pageNum, viewport) {
  state.highlights.forEach(h => {
    if (h.page === pageNum) {
      ctx.fillStyle = h.color + '15';
      ctx.fillRect(h.x, h.y, h.w, h.h);

      // Border
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x, h.y, h.w, h.h);
    }
  });
}

async function drawPencilMarks(pageNum) {
  state.pencilMarks.forEach(mark => {
    if (mark.page === pageNum && mark.points && mark.points.length > 0) {
      ctx.strokeStyle = mark.color;
      ctx.lineWidth = mark.size || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(mark.points[0].x, mark.points[0].y);
      
      for (let i = 1; i < mark.points.length; i++) {
        ctx.lineTo(mark.points[i].x, mark.points[i].y);
      }
      
      ctx.stroke();
    }
  });
}

async function drawTextNotes(pageNum) {
  state.textNotes.forEach(note => {
    if (note.page === pageNum) {
      // Draw yellow sticky note background
      const noteWidth = Math.max(120, note.text.length * 7);
      const noteHeight = 40;
      
      ctx.fillStyle = note.color + 'DD';
      ctx.fillRect(note.x, note.y, noteWidth, noteHeight);
      
      // Border
      ctx.strokeStyle = '#DAA520';
      ctx.lineWidth = 2;
      ctx.strokeRect(note.x, note.y, noteWidth, noteHeight);
      
      // Text
      ctx.fillStyle = '#000000';
      ctx.font = '12px Arial';
      ctx.textBaseline = 'top';
      
      // Wrap text if needed
      const maxCharsPerLine = 15;
      const lines = [];
      for (let i = 0; i < note.text.length; i += maxCharsPerLine) {
        lines.push(note.text.substr(i, maxCharsPerLine));
      }
      
      lines.forEach((line, index) => {
        ctx.fillText(line, note.x + 5, note.y + 5 + (index * 14));
      });
    }
  });
}

function updatePageInfo() {
  document.getElementById('page-counter').textContent = `${state.page} / ${pdfDoc.numPages}`;
  document.getElementById('page-info').textContent = `Page ${state.page}`;
}

/* ========== INITIALIZE PDF ========== */
async function initPdf(pdfSource = null) {
  try {
    if (!pdfSource) {
      // Try to load from previous session or show upload prompt
      const savedPdfUrl = sessionStorage.getItem('pdf-url');
      if (savedPdfUrl) {
        pdfSource = savedPdfUrl;
      } else {
        showToast('📤 Please upload a PDF file to get started');
        return;
      }
    }

    pdfDoc = await pdfjsLib.getDocument(pdfSource).promise;
    await renderPage(state.page);
    loadChapters();
    console.log('PDF loaded successfully');
  } catch (e) {
    console.error('Error loading PDF:', e);
    showToast('❌ Error loading PDF file');
  }
}

/* ========== CHAPTERS ========== */
async function loadChapters() {
  const chaptersDiv = document.getElementById('chapters');
  chaptersDiv.innerHTML = '';

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ');

      // Detect chapters
      const chapterMatch = text.match(/Chapter\s+(\d+)|Chapter\s+([A-Z])/i);
      if (chapterMatch || i === 1) {
        const chapterTitle = chapterMatch
          ? `Chapter ${chapterMatch[1] || chapterMatch[2]}`
          : `Page ${i}`;

        const el = document.createElement('div');
        el.className = 'chapter-item';
        el.textContent = chapterTitle;
        el.dataset.page = i;

        if (i === state.page) el.classList.add('active');

        el.addEventListener('click', () => {
          document.querySelectorAll('.chapter-item').forEach(e => e.classList.remove('active'));
          el.classList.add('active');
          renderPage(i);
        });

        chaptersDiv.appendChild(el);
      }
    } catch (e) {
      console.error(`Error reading page ${i}:`, e);
    }
  }
}

/* ========== SETUP EVENT LISTENERS ========== */
function setupEventListeners() {
  /* ========== PDF UPLOAD ========== */
  const pdfUpload = document.getElementById('pdf-upload');
  const uploadBtn = document.getElementById('upload-btn');

  uploadBtn.addEventListener('click', () => {
    pdfUpload.click();
  });

  pdfUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      const fileUrl = URL.createObjectURL(file);
      sessionStorage.setItem('pdf-url', fileUrl);
      state.page = 1; // Reset to first page
      saveState();
      initPdf(fileUrl);
      showToast(`📄 Loaded: ${file.name}`);
    } else {
      showToast('❌ Please select a valid PDF file');
    }
    pdfUpload.value = ''; // Reset file input
  });

  /* ========== ZOOM CONTROLS ========== */
  const zoomFit = document.getElementById('zoom-fit');
  const zoom50 = document.getElementById('zoom-50');
  const zoom100 = document.getElementById('zoom-100');
  const zoom150 = document.getElementById('zoom-150');
  const zoomSelect = document.getElementById('zoom-select');

  function setZoom(level) {
    state.zoom = level;
    saveState();

    // Update button active states
    [zoomFit, zoom50, zoom100, zoom150].forEach(btn => btn.classList.remove('active'));
    zoomSelect.value = level;

    if (level === 'fit') {
      zoomFit.classList.add('active');
    } else if (level === '50') {
      zoom50.classList.add('active');
    } else if (level === '100') {
      zoom100.classList.add('active');
    } else if (level === '150') {
      zoom150.classList.add('active');
    }

    if (pdfDoc) {
      renderPage(state.page);
    }
  }

  zoomFit.addEventListener('click', () => setZoom('fit'));
  zoom50.addEventListener('click', () => setZoom('50'));
  zoom100.addEventListener('click', () => setZoom('100'));
  zoom150.addEventListener('click', () => setZoom('150'));

  zoomSelect.addEventListener('change', (e) => {
    setZoom(e.target.value);
  });

  // Set initial zoom button state
  if (state.zoom === 'fit') zoomFit.classList.add('active');

  /* ========== CANVAS INTERACTION: HIGHLIGHTING ========== */
  let isSelecting = false;
  let startX = 0, startY = 0;
  let isDragging = false;
  let draggedTextNote = null;

  canvas.addEventListener('mousedown', (e) => {
    // Don't allow highlighting if pencil, eraser, or in text mode
    if (isPencilMode || isEraserMode) return;
    
    // Check if clicking on a text note (for dragging)
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    for (const note of state.textNotes) {
      if (note.page === state.page) {
        const noteWidth = Math.max(120, note.text.length * 7);
        const noteHeight = 40;
        
        if (clickX >= note.x && clickX <= note.x + noteWidth &&
            clickY >= note.y && clickY <= note.y + noteHeight) {
          draggedTextNote = note;
          startX = clickX;
          startY = clickY;
          return; // Don't start highlighting
        }
      }
    }
    
    startX = clickX;
    startY = clickY;
    isSelecting = true;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isSelecting && !draggedTextNote) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    // Handle text note dragging
    if (draggedTextNote) {
      const dx = currentX - startX;
      const dy = currentY - startY;
      draggedTextNote.x += dx;
      draggedTextNote.y += dy;
      startX = currentX;
      startY = currentY;
      renderPage(state.page);
      return;
    }
    
    const dx = Math.abs(currentX - startX);
    const dy = Math.abs(currentY - startY);
    
    // Mark as dragging if moved more than 5px
    if (dx > 5 || dy > 5) {
      isDragging = true;
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    // Handle text note drop
    if (draggedTextNote) {
      draggedTextNote = null;
      saveState();
      return;
    }
    
    if (!isSelecting) return;
    isSelecting = false;

    const rect = canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    // Only add highlight if we actually dragged
    if (isDragging && w > 5 && h > 5) {
      const color = highlightColorInput.value;
      state.highlights.push({ page: state.page, x, y, w, h, color });
      saveState();
      renderPage(state.page);
    }
    
    isDragging = false;
  });

  // Double-click handler for highlight removal only
  canvas.addEventListener('dblclick', async (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Remove highlight if clicked on one
    const highlightRemoved = state.highlights.some(h => {
      return (
        h.page === state.page &&
        h.x <= x && x <= h.x + h.w &&
        h.y <= y && y <= h.y + h.h
      );
    });

    if (highlightRemoved) {
      state.highlights = state.highlights.filter(h => {
        return !(
          h.page === state.page &&
          h.x <= x && x <= h.x + h.w &&
          h.y <= y && y <= h.y + h.h
        );
      });
      saveState();
      renderPage(state.page);
      showToast('🗑️ Highlight removed');
    }
  });


  /* ========== CANVAS INTERACTION: PENCIL & DRAWING ========== */
  let isPencilMode = false;
  let isEraserMode = false;
  let isPencilDrawing = false;
  let pencilStartX = 0, pencilStartY = 0;
  let currentPencilMark = null;
  
  const pencilToggle = document.getElementById('pencil-toggle');
  const eraserToggle = document.getElementById('eraser-toggle');
  const pencilColor = document.getElementById('pencil-color');
  const pencilSize = document.getElementById('pencil-size');
  const eraserSize = document.getElementById('eraser-size');
  
  // Pencil color palette
  document.querySelectorAll('.pencil-color').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      pencilColor.value = color;
    });
  });
  
  pencilToggle.addEventListener('click', () => {
    isPencilMode = !isPencilMode;
    isEraserMode = false;
    pencilToggle.classList.toggle('active');
    eraserToggle.classList.remove('active');
    canvas.style.cursor = isPencilMode ? 'crosshair' : 'default';
    showToast(isPencilMode ? '✏️ Pencil mode ON' : '✏️ Pencil mode OFF');
  });
  
  eraserToggle.addEventListener('click', () => {
    isEraserMode = !isEraserMode;
    isPencilMode = false;
    eraserToggle.classList.toggle('active');
    pencilToggle.classList.remove('active');
    canvas.style.cursor = isEraserMode ? 'cell' : 'default';
    showToast(isEraserMode ? '🧹 Eraser mode ON' : '🧹 Eraser mode OFF');
  });
  
  // Function to erase pencil marks in a circular area
  function erasePencilMarks(eraserX, eraserY, eraserRadius) {
    const pageMarks = state.pencilMarks.filter(m => m.page === state.page);
    
    pageMarks.forEach(mark => {
      // Filter points that are outside the eraser area
      const originalLength = mark.points.length;
      mark.points = mark.points.filter(point => {
        const distance = Math.sqrt(
          Math.pow(point.x - eraserX, 2) + Math.pow(point.y - eraserY, 2)
        );
        return distance > eraserRadius;
      });
      
      // If all points were erased, remove the entire mark
      if (mark.points.length === 0) {
        state.pencilMarks = state.pencilMarks.filter(m => m !== mark);
      }
    });
    
    saveState();
  }
  
  canvas.addEventListener('mousedown', (e) => {
    if (!isPencilMode && !isEraserMode) return;
    
    isPencilDrawing = true;
    const rect = canvas.getBoundingClientRect();
    pencilStartX = e.clientX - rect.left;
    pencilStartY = e.clientY - rect.top;
    
    if (isPencilMode) {
      currentPencilMark = {
        page: state.page,
        points: [{x: pencilStartX, y: pencilStartY}],
        color: pencilColor.value,
        size: parseInt(pencilSize.value)
      };
    }
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (!isPencilDrawing) return;
    
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    if (isPencilMode && currentPencilMark) {
      // Draw line on canvas
      ctx.strokeStyle = pencilColor.value;
      ctx.lineWidth = pencilSize.value;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pencilStartX, pencilStartY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
      
      // Store point
      currentPencilMark.points.push({x: currentX, y: currentY});
      
      pencilStartX = currentX;
      pencilStartY = currentY;
    } else if (isEraserMode) {
      // Erase pencil marks in the eraser area
      erasePencilMarks(currentX, currentY, parseInt(eraserSize.value));
      renderPage(state.page);
    }
  });
  
  canvas.addEventListener('mouseup', (e) => {
    if (!isPencilDrawing) return;
    isPencilDrawing = false;
    
    if (isPencilMode && currentPencilMark && currentPencilMark.points.length > 1) {
      state.pencilMarks.push(currentPencilMark);
      saveState();
    }
    
    currentPencilMark = null;
  });
  
  // Clear pencil marks
  document.getElementById('clear-pencil-btn').addEventListener('click', () => {
    if (confirm('Clear all pencil marks on this page?')) {
      state.pencilMarks = state.pencilMarks.filter(m => m.page !== state.page);
      saveState();
      renderPage(state.page);
      showToast('✏️ Pencil marks cleared');
    }
  });


  /* ========== TEXT NOTES ========== */
  const textNoteInput = document.getElementById('text-note-input');
  const addTextNoteBtn = document.getElementById('add-text-note-btn');
  const clearTextNotesBtn = document.getElementById('clear-text-notes-btn');
  
  addTextNoteBtn.addEventListener('click', () => {
    if (!pdfDoc) {
      showToast('⚠️ Load a PDF first');
      return;
    }
    
    const text = textNoteInput.value.trim();
    if (!text) {
      showToast('⚠️ Enter text first');
      return;
    }
    
    // Generate random position on canvas
    const canvasWidth = canvas.width || 600;
    const canvasHeight = canvas.height || 800;
    const noteWidth = Math.max(120, text.length * 7);
    const noteHeight = 40;
    
    const maxX = Math.max(20, canvasWidth - noteWidth - 20);
    const maxY = Math.max(20, canvasHeight - noteHeight - 20);
    
    const randomX = Math.random() * maxX;
    const randomY = Math.random() * maxY;
    
    // Add note at random position
    const note = {
      page: state.page,
      x: randomX,
      y: randomY,
      text: text,
      color: '#FFD700'
    };
    
    state.textNotes.push(note);
    saveState();
    renderPage(state.page);
    textNoteInput.value = '';
    showToast('📝 Note added (drag to move)');
  });
  
  clearTextNotesBtn.addEventListener('click', () => {
    if (confirm('Clear all text notes on this page?')) {
      state.textNotes = state.textNotes.filter(n => n.page !== state.page);
      saveState();
      renderPage(state.page);
      showToast('📝 Text notes cleared');
    }
  });


  /* ========== DICTIONARY ========== */
  const dictSearchInput = document.getElementById('dict-search-input');
  const dictSearchBtn = document.getElementById('dict-search-btn');

  // Dictionary search button
  dictSearchBtn.addEventListener('click', () => {
    const word = dictSearchInput.value.trim();
    if (word) {
      fetchDictionary(word);
      showToast(`📚 Searching for "${word}"...`);
    }
  });

  // Dictionary search on Enter key
  dictSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const word = dictSearchInput.value.trim();
      if (word) {
        fetchDictionary(word);
      }
    }
  });

  canvas.addEventListener('click', async (e) => {
    if (!state.dictionaryEnabled || !pdfDoc) return;

    try {
      const page = await pdfDoc.getPage(state.page);
      const textContent = await page.getTextContent();

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      let selectedWord = '';

      for (const item of textContent.items) {
        if (!item.transformed) continue;

        const itemX = item.transformed[4];
        const itemY = item.transformed[5];

        const distance = Math.sqrt(
          Math.pow(clickX - itemX, 2) + Math.pow(clickY - itemY, 2)
        );

        if (distance < 30) {
          selectedWord = item.str.trim();
          break;
        }
      }

      if (selectedWord) {
        console.log('Looking up word:', selectedWord);
        dictSearchInput.value = selectedWord;
        fetchDictionary(selectedWord);
      }
    } catch (e) {
      console.error('Error getting word:', e);
    }
  });

  /* ========== TEXT READER ========== */
  const synth = window.speechSynthesis;
  const playBtn = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const volumeControl = document.getElementById('volume-control');
  const rateControl = document.getElementById('rate-control');
  const voiceSelect = document.getElementById('voice-select');
  
  let selectedVoiceIndex = 0;
  let isPlaying = false;
  let isPaused = false;
  let currentUtterance = null;
  let pageTextItems = [];
  
  // Populate voice list
  function populateVoices() {
    const voices = synth.getVoices();
    voiceSelect.innerHTML = '';
    
    voices.forEach((voice, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${voice.name} (${voice.lang})`;
      voiceSelect.appendChild(option);
    });
    
    if (voices.length > 0) {
      voiceSelect.value = 0;
      selectedVoiceIndex = 0;
    }
  }
  
  // Populate voices on load and when voices change
  populateVoices();
  synth.onvoiceschanged = populateVoices;
  
  voiceSelect.addEventListener('change', (e) => {
    selectedVoiceIndex = parseInt(e.target.value);
  });

  async function readPageAloud() {
    if (!pdfDoc) return;

    try {
      if (synth.speaking) {
        synth.cancel();
      }
      
      isPlaying = true;
      isPaused = false;
      playBtn.classList.add('hidden');
      pauseBtn.classList.remove('hidden');

      const page = await pdfDoc.getPage(state.page);
      const textContent = await page.getTextContent();
      pageTextItems = textContent.items;
      const text = pageTextItems.map(item => item.str).join(' ');

      if (!text.trim()) {
        showToast('No text found on this page');
        playBtn.classList.remove('hidden');
        pauseBtn.classList.add('hidden');
        isPlaying = false;
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      if (voices.length > 0) {
        utterance.voice = voices[selectedVoiceIndex];
      }
      utterance.volume = volumeControl.value / 100;
      utterance.rate = parseFloat(rateControl.value);
      utterance.pitch = 1;

      // Track word-by-word as it's being read
      utterance.onboundary = (event) => {
        if (event.name === 'word' && isPlaying && !isPaused) {
          const charIndex = event.charIndex;
          highlightCurrentWord(pageTextItems, charIndex, text);
        }
      };

      utterance.onend = () => {
        isPlaying = false;
        isPaused = false;
        playBtn.classList.remove('hidden');
        pauseBtn.classList.add('hidden');
        renderPage(state.page);
      };

      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        isPlaying = false;
        isPaused = false;
        playBtn.classList.remove('hidden');
        pauseBtn.classList.add('hidden');
      };

      currentUtterance = utterance;
      synth.speak(utterance);
    } catch (e) {
      console.error('Error reading page:', e);
      isPlaying = false;
      isPaused = false;
      playBtn.classList.remove('hidden');
      pauseBtn.classList.add('hidden');
    }
  }
  
  // Highlight the current word being read with improved accuracy
  async function highlightCurrentWord(textItems, charIndex, fullText) {
    if (!pdfDoc || !isPlaying) return;
    
    try {
      const page = await pdfDoc.getPage(state.page);
      const viewport = page.getViewport({ scale: 1 });
      
      let scale = pdfScale;
      if (state.zoom === 'fit') {
        const container = document.getElementById('canvas-wrapper');
        scale = (container.clientWidth - 40) / viewport.width;
      } else {
        scale = (parseInt(state.zoom) / 100) * 1.5;
      }
      
      const scaledViewport = page.getViewport({ scale });
      
      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport
      }).promise;
      
      await drawHighlights(page, state.page, scaledViewport);
      
      // Find current word and highlight it
      let currentChar = 0;
      for (const item of textItems) {
        if (!item.transformed) {
          currentChar += (item.str || '').length;
          continue;
        }
        
        const itemLength = item.str.length;
        if (charIndex >= currentChar && charIndex < currentChar + itemLength) {
          const itemX = item.transformed[4];
          const itemY = item.transformed[5];
          const itemWidth = item.width || 8;
          const itemHeight = item.height || 12;
          
          ctx.fillStyle = '#FFD700CC';
          ctx.fillRect(itemX, itemY, itemWidth, itemHeight);
          ctx.strokeStyle = '#FFA500';
          ctx.lineWidth = 2;
          ctx.strokeRect(itemX, itemY, itemWidth, itemHeight);
          break;
        }
        
        currentChar += itemLength;
      }
    } catch (e) {
      console.error('Error highlighting word:', e);
    }
  }

  playBtn.addEventListener('click', () => {
    if (isPaused) {
      // Resume from pause
      synth.resume();
      isPaused = false;
      playBtn.classList.add('hidden');
      pauseBtn.classList.remove('hidden');
    } else if (!isPlaying) {
      // Start reading from beginning
      readPageAloud();
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (isPlaying && !isPaused) {
      synth.pause();
      isPaused = true;
      playBtn.classList.remove('hidden');
      pauseBtn.classList.add('hidden');
    }
  });

  stopBtn.addEventListener('click', () => {
    synth.cancel();
    isPlaying = false;
    isPaused = false;
    playBtn.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    renderPage(state.page);
  });

  // Volume adjustment - just change property, don't restart
  volumeControl.addEventListener('input', (e) => {
    if (synth.speaking) {
      synth.volume = e.target.value / 100;
    }
  });

  // Rate adjustment - just change property, don't restart
  rateControl.addEventListener('input', (e) => {
    if (synth.speaking) {
      // Note: rate change takes effect on next utterance in some browsers
      // But we update the current utterance's rate property
      if (currentUtterance) {
        currentUtterance.rate = parseFloat(e.target.value);
      }
    }
  });

  /* ========== NAVIGATION ========== */
  document.getElementById('prev-page').addEventListener('click', () => {
    if (state.page > 1) {
      renderPage(state.page - 1);
      updateChapterHighlight();
    }
  });

  document.getElementById('next-page').addEventListener('click', () => {
    if (state.page < pdfDoc.numPages) {
      renderPage(state.page + 1);
      updateChapterHighlight();
    }
  });

  /* ========== NOTEBOOK ========== */
  notebookEl.value = state.notes;
  notebookEl.addEventListener('input', (e) => {
    state.notes = e.target.value;
    saveState();
  });

  /* ========== THEME TOGGLE ========== */
  const themeDayBtn = document.getElementById('theme-day');
  const themeNightBtn = document.getElementById('theme-night');

  themeDayBtn.addEventListener('click', () => applyTheme('day'));
  themeNightBtn.addEventListener('click', () => applyTheme('night'));

  /* ========== SETTINGS MODAL ========== */
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeBtn = document.querySelector('.close-btn');

  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  closeBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  /* ========== COLOR PALETTE ========== */
  // Highlight color buttons (not pencil)
  document.querySelectorAll('#dict-tab .color-btn, #tools-tab .color-btn:not(.pencil-color)').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      highlightColorInput.value = color;
      highlightColorInput.dispatchEvent(new Event('change'));
    });
  });
  
  // Tools highlight color input sync
  const toolsHighlightColor = document.getElementById('tools-highlight-color');
  if (toolsHighlightColor) {
    toolsHighlightColor.addEventListener('change', (e) => {
      highlightColorInput.value = e.target.value;
    });
  }

  /* ========== TAB SWITCHING ========== */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      const sidebar = btn.closest('[id^="sidebar-"]');
      const tabContents = sidebar.querySelectorAll('.tab-content');
      const tabBtns = sidebar.querySelectorAll('.tab-btn');

      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      sidebar.querySelector(`#${tab}-tab`).classList.add('active');
    });
  });

  /* ========== CLEAR HIGHLIGHTS ========== */
  document.getElementById('clear-highlights-btn').addEventListener('click', () => {
    if (confirm('Clear all highlights on this page?')) {
      state.highlights = state.highlights.filter(h => h.page !== state.page);
      saveState();
      renderPage(state.page);
      showToast('Highlights cleared');
    }
  });
}

/* ========== TOAST NOTIFICATION ========== */
function showToast(message) {
  copyToast.textContent = message;
  copyToast.classList.remove('hidden');
  setTimeout(() => {
    copyToast.classList.add('hidden');
  }, 2000);
}

/* ========== DICTIONARY FETCH ========== */
async function fetchDictionary(word) {
  try {
    console.log('Fetching dictionary for:', word);
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`
    );

    if (!response.ok) {
      dictPanel.innerHTML = `<p class="placeholder">No definition found for "${word}"</p>`;
      return;
    }

    const data = await response.json();
    const entry = data[0];

    let html = `<div class="word">${entry.word}</div>`;

    if (entry.phonetic) {
      html += `<div class="phonetic">/${entry.phonetic}/</div>`;
    }

    if (entry.meanings) {
      entry.meanings.forEach(meaning => {
        html += `<div class="meaning">
          <div class="meaning-type"><i>${meaning.partOfSpeech}</i></div>`;

        if (meaning.definitions) {
          meaning.definitions.forEach(def => {
            html += `<div class="definition">${def.definition}</div>`;
          });
        }

        html += `</div>`;
      });
    }

    dictPanel.innerHTML = html;
    console.log('Dictionary loaded successfully');
  } catch (e) {
    console.error('Dictionary error:', e);
    dictPanel.innerHTML = `<p class="placeholder">Error loading definition</p>`;
  }
}

/* ========== APPLY THEME ========== */
function applyTheme(theme) {
  state.theme = theme;
  document.body.className = theme;
  saveState();

  const themeDayBtn = document.getElementById('theme-day');
  const themeNightBtn = document.getElementById('theme-night');

  if (theme === 'day') {
    themeDayBtn.classList.add('active');
    themeNightBtn.classList.remove('active');
  } else {
    themeDayBtn.classList.remove('active');
    themeNightBtn.classList.add('active');
  }
}

function updateChapterHighlight() {
  document.querySelectorAll('.chapter-item').forEach(el => {
    el.classList.remove('active');
    if (parseInt(el.dataset.page) === state.page) {
      el.classList.add('active');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

/* ========== INITIALIZE APP ========== */
function initializeApp() {
  initDOMElements();
  loadState();
  applyTheme(state.theme);
  setupEventListeners();

  if (!state.dictionaryEnabled) {
    const dictToggle = document.getElementById('dict-toggle');
    dictToggle.classList.add('disabled');
    const dictStatus = document.getElementById('dict-status');
    dictStatus.textContent = 'OFF';
  }

  initPdf();
}

// Start the app
document.addEventListener('DOMContentLoaded', initializeApp);

