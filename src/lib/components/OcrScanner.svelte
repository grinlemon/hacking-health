<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import Tesseract from 'tesseract.js';

  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let audioElement: HTMLAudioElement;

  // État de l'application
  let stream: MediaStream | null = null;
  let capturedImage: string | null = null;
  let extractedText: string = '';
  let statusMessage: string = 'Prêt à scanner une page';
  let statusType: 'info' | 'success' | 'error' | 'warning' = 'info';
  
  // États UI
  let showVideo: boolean = false;
  let showCaptureBtn: boolean = false;
  let showProcessBtn: boolean = false;
  let showPlayBtn: boolean = false;
  let isProcessing: boolean = false;
  let isGenerating: boolean = false;
  let isPlaying: boolean = false;
  let audioUrl: string | null = null;

  let textLength: number = 0;

  function updateStatus(message: string, type: typeof statusType = 'info'): void {
    statusMessage = message;
    statusType = type;
  }

  async function startCamera(): Promise<void> {
    try {
      updateStatus('Démarrage de la caméra...', 'info');
      
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      video.srcObject = stream;
      showVideo = true;
      showCaptureBtn = true;
      
      updateStatus('📸 Positionnez la page et capturez', 'success');
    } catch (err) {
      updateStatus('Erreur caméra: ' + (err as Error).message, 'error');
    }
  }

  function captureImage(): void {
    const context = canvas.getContext('2d');
    if (!context) return;

    // Capturer l'image
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    capturedImage = canvas.toDataURL('image/jpeg', 0.95);
    
    // Arrêter la caméra
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    
    showVideo = false;
    showCaptureBtn = false;
    showProcessBtn = true;
    
    updateStatus('✅ Image capturée', 'success');
  }

  async function processOCR(): Promise<void> {
    if (!capturedImage) return;

    try {
      isProcessing = true;
      updateStatus('🔍 Analyse OCR en cours...', 'info');

      const result = await Tesseract.recognize(
        capturedImage,
        'fra+eng',
        {
          logger: (m: Tesseract.LoggerMessage) => {
            if (m.status === 'recognizing text') {
              const progress = Math.round(m.progress * 100);
              updateStatus(`📖 Analyse: ${progress}%`, 'info');
            }
          }
        }
      );

      extractedText = result.data.text.trim();
      textLength = extractedText.length;
      
      if (extractedText && extractedText.length > 10) {
        showPlayBtn = true;
        updateStatus(`✅ ${textLength} caractères détectés`, 'success');
      } else {
        updateStatus('⚠️ Peu de texte détecté - Réessayez', 'warning');
        showPlayBtn = true; // Permettre quand même de tester
      }

      isProcessing = false;
      
    } catch (err) {
      updateStatus('Erreur OCR: ' + (err as Error).message, 'error');
      isProcessing = false;
    }
  }

  async function generateAndPlayAudio(): Promise<void> {
    if (!extractedText) return;

    try {
      isGenerating = true;
      updateStatus('🎤 Génération audio...', 'info');

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: extractedText })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erreur ${response.status}: ${errorText}`);
      }

      const blob = await response.blob();
      
      // Nettoyer l'ancien URL
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      
      audioUrl = URL.createObjectURL(blob);

      if (audioElement) {
        audioElement.src = audioUrl;
        await audioElement.play();
        isPlaying = true;
        updateStatus('🔊 Lecture en cours...', 'info');
      }

      isGenerating = false;
      
    } catch (err) {
      updateStatus('Erreur TTS: ' + (err as Error).message, 'error');
      isGenerating = false;
      console.error('Erreur complète:', err);
    }
  }

  function togglePlayPause(): void {
    if (!audioElement || !audioUrl) return;

    if (isPlaying) {
      audioElement.pause();
      isPlaying = false;
      updateStatus('⏸️ Pause', 'info');
    } else {
      audioElement.play();
      isPlaying = true;
      updateStatus('🔊 Lecture...', 'info');
    }
  }

  function resetCapture(): void {
    capturedImage = null;
    extractedText = '';
    showProcessBtn = false;
    showPlayBtn = false;
    textLength = 0;
    
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    
    isPlaying = false;
    
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    
    updateStatus('Prêt pour une nouvelle capture', 'info');
  }

  function handleAudioEnd(): void {
    isPlaying = false;
    updateStatus('✅ Lecture terminée', 'success');
  }

  onDestroy(() => {
    if (browser && stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
  });
</script>

<div class="container">
  <h1>📖 Lecteur de Page</h1>
  <p class="subtitle">Scanner • OCR • Audio</p>
  
  <div class="status status-{statusType}">
    {statusMessage}
  </div>

  <div class="camera-container">
    {#if showVideo}
      <!-- svelte-ignore a11y-media-has-caption -->
      <video bind:this={video} autoplay playsinline></video>
      <div class="guide-overlay">
        <div class="frame"></div>
        <p>Positionnez la page</p>
      </div>
    {:else if capturedImage}
      <img src={capturedImage} alt="Page capturée" class="preview" />
    {:else}
      <div class="placeholder">
        <div class="icon">📄</div>
        <p>Prêt à scanner</p>
      </div>
    {/if}
    <canvas bind:this={canvas} class="hidden"></canvas>
  </div>

  <div class="controls">
    {#if !showVideo && !capturedImage}
      <button class="btn btn-primary" on:click={startCamera}>
        📷 Démarrer
      </button>
    {/if}
    
    {#if showCaptureBtn}
      <button class="btn btn-capture" on:click={captureImage}>
        📸 Capturer
      </button>
    {/if}

    {#if showProcessBtn}
      <button 
        class="btn btn-primary" 
        on:click={processOCR}
        disabled={isProcessing}
      >
        {isProcessing ? '⏳ Analyse...' : '🔍 Extraire le texte'}
      </button>
    {/if}

    {#if showPlayBtn}
      {#if audioUrl}
        <button class="btn btn-play" on:click={togglePlayPause}>
          {isPlaying ? '⏸️ Pause' : '▶️ Lire'}
        </button>
      {:else}
        <button 
          class="btn btn-play" 
          on:click={generateAndPlayAudio}
          disabled={isGenerating}
        >
          {isGenerating ? '⏳ Génération...' : '🎤 Générer l\'audio'}
        </button>
      {/if}

      <button class="btn btn-secondary" on:click={resetCapture}>
        🔄 Recommencer
      </button>
    {/if}
  </div>

  {#if extractedText}
    <div class="text-box">
      <div class="text-header">
        <h3>📄 Texte extrait</h3>
        <span class="badge">{textLength} caractères</span>
      </div>
      <p class="text-content">{extractedText}</p>
    </div>
  {/if}

  <audio 
    bind:this={audioElement}
    on:ended={handleAudioEnd}
    class="hidden"
  ></audio>
</div>

<style>
  .container {
    max-width: 800px;
    margin: 20px auto;
    padding: 24px;
    background: white;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }

  h1 {
    color: #4F46E5;
    text-align: center;
    margin-bottom: 8px;
    font-size: 32px;
  }

  .subtitle {
    text-align: center;
    color: #6B7280;
    margin-bottom: 24px;
    font-size: 16px;
  }

  .camera-container {
    position: relative;
    width: 100%;
    margin-bottom: 20px;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
    min-height: 400px;
  }

  video, .preview {
    width: 100%;
    display: block;
    border-radius: 12px;
  }

  .guide-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .frame {
    border: 3px dashed rgba(255, 255, 255, 0.8);
    width: 80%;
    height: 70%;
    border-radius: 8px;
  }

  .guide-overlay p {
    color: white;
    background: rgba(0, 0, 0, 0.7);
    padding: 10px 20px;
    border-radius: 20px;
    margin-top: 20px;
    font-weight: 600;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%);
  }

  .placeholder .icon {
    font-size: 80px;
    margin-bottom: 20px;
  }

  .placeholder p {
    color: #6B7280;
    font-size: 18px;
  }

  .hidden {
    display: none;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .btn {
    width: 100%;
    padding: 16px;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
  }

  .btn-primary {
    background: #4F46E5;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #4338CA;
    transform: translateY(-2px);
  }

  .btn-capture {
    background: #10B981;
    color: white;
    font-size: 18px;
    padding: 20px;
  }

  .btn-capture:hover {
    background: #059669;
    transform: scale(1.02);
  }

  .btn-play {
    background: #F59E0B;
    color: white;
    font-size: 18px;
  }

  .btn-play:hover:not(:disabled) {
    background: #D97706;
  }

  .btn-secondary {
    background: #6B7280;
    color: white;
  }

  .btn-secondary:hover {
    background: #4B5563;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status {
    padding: 16px;
    border-radius: 12px;
    margin-bottom: 20px;
    font-size: 15px;
    font-weight: 500;
    text-align: center;
  }

  .status-info {
    background: #DBEAFE;
    color: #1E40AF;
  }

  .status-success {
    background: #D1FAE5;
    color: #065F46;
  }

  .status-error {
    background: #FEE2E2;
    color: #991B1B;
  }

  .status-warning {
    background: #FEF3C7;
    color: #92400E;
  }

  .text-box {
    margin-top: 20px;
    padding: 20px;
    background: #F9FAFB;
    border-radius: 12px;
    border: 2px solid #E5E7EB;
    max-height: 300px;
    overflow-y: auto;
  }

  .text-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .text-header h3 {
    color: #4F46E5;
    font-size: 18px;
    margin: 0;
  }

  .badge {
    background: #4F46E5;
    color: white;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }

  .text-content {
    line-height: 1.8;
    color: #374151;
    white-space: pre-wrap;
    margin: 0;
  }
</style>