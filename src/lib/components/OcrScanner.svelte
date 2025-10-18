<script lang="ts">
  import { browser } from '$app/environment';
  import Tesseract from 'tesseract.js';

  // Variables réactives Svelte 5
  let video = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();
  let audioElement = $state<HTMLAudioElement>();

  // État simplifié
  let stream = $state<MediaStream | null>(null);
  let extractedText = $state('');
  let rawOcrText = $state('');
  let statusMessage = $state('');
  let progressPercent = $state(0);
  
  // États du workflow
  type AppState = 'camera' | 'processing' | 'ready' | 'playing' | 'paused';
  let appState = $state<AppState>('camera');
  
  let audioUrl = $state<string | null>(null);

  // Démarrer la caméra automatiquement
  async function initCamera(): Promise<void> {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      stream = mediaStream;
      appState = 'camera';
    } catch (err) {
      console.error('Erreur caméra:', err);
      statusMessage = 'Erreur caméra: ' + (err as Error).message;
    }
  }

  // Capturer et tout traiter
  async function startProcessing(): Promise<void> {
    if (!canvas || !video) return;
    
    appState = 'processing';
    statusMessage = 'Capture en cours...';
    progressPercent = 0;

    try {
      // 1. CAPTURER
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const capturedImage = canvas.toDataURL('image/jpeg', 0.95);
      
      // Arrêter la caméra
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }

      progressPercent = 10;

      // 2. DIVISER L'IMAGE
      statusMessage = 'Découpage des pages...';
      const [leftPageImg, rightPageImg] = await splitImageInTwo(capturedImage);
      progressPercent = 15;

      // 3. OCR PAGE GAUCHE
      statusMessage = 'Lecture page gauche...';
      const leftResult = await Tesseract.recognize(leftPageImg, 'fra+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            progressPercent = 15 + Math.round(m.progress * 30);
          }
        }
      });
      const leftText = leftResult.data.text.trim();

      // 4. OCR PAGE DROITE
      statusMessage = 'Lecture page droite...';
      const rightResult = await Tesseract.recognize(rightPageImg, 'fra+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            progressPercent = 45 + Math.round(m.progress * 30);
          }
        }
      });
      const rightText = rightResult.data.text.trim();

      const rawText = leftText + '\n\n--- PAGE SUIVANTE ---\n\n' + rightText;
      rawOcrText = rawText;
      progressPercent = 75;

      // 5. NETTOYER AVEC GROQ
      statusMessage = 'Nettoyage du texte...';
      const cleanResponse = await fetch('/api/clean-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, isDoublePage: true })
      });

      if (cleanResponse.ok) {
        const { cleanedText } = await cleanResponse.json();
        extractedText = cleanedText;
      } else {
        extractedText = rawText;
      }

      progressPercent = 100;
      statusMessage = 'Prêt à lire';
      appState = 'ready';

    } catch (err) {
      console.error('Erreur:', err);
      statusMessage = 'Erreur: ' + (err as Error).message;
      appState = 'camera';
      await initCamera();
    }
  }

  // Générer et lire l'audio
  async function playAudio(): Promise<void> {
    if (!extractedText) return;

    try {
      if (appState === 'paused' && audioElement) {
        // Reprendre la lecture
        await audioElement.play();
        appState = 'playing';
        return;
      }

      // Générer l'audio si pas déjà fait
      if (!audioUrl) {
        statusMessage = 'Génération audio...';
        
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: extractedText })
        });

        if (!response.ok) {
          throw new Error('Erreur génération audio');
        }

        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
      }

      // Lire
      if (audioElement && audioUrl) {
        audioElement.src = audioUrl;
        await audioElement.play();
        appState = 'playing';
        statusMessage = 'Lecture en cours';
      }

    } catch (err) {
      console.error('Erreur audio:', err);
      statusMessage = 'Erreur: ' + (err as Error).message;
    }
  }

  // Pause
  function pauseAudio(): void {
    if (audioElement) {
      audioElement.pause();
      appState = 'paused';
      statusMessage = 'En pause';
    }
  }

  // Recommencer
  function restart(): void {
    extractedText = '';
    rawOcrText = '';
    statusMessage = '';
    progressPercent = 0;
    
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    
    initCamera();
  }

  // Fin de lecture
  function handleAudioEnd(): void {
    appState = 'ready';
    statusMessage = 'Lecture terminée';
  }

  // Diviser l'image
  function splitImageInTwo(imageDataUrl: string): Promise<[string, string]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Canvas error'));
          return;
        }
        
        const halfWidth = Math.floor(img.width / 2);
        
        tempCanvas.width = halfWidth;
        tempCanvas.height = img.height;
        ctx.drawImage(img, 0, 0, halfWidth, img.height, 0, 0, halfWidth, img.height);
        const leftPage = tempCanvas.toDataURL('image/jpeg', 0.95);
        
        ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(img, halfWidth, 0, halfWidth, img.height, 0, 0, halfWidth, img.height);
        const rightPage = tempCanvas.toDataURL('image/jpeg', 0.95);
        
        resolve([leftPage, rightPage]);
      };
      
      img.onerror = () => reject(new Error('Image error'));
      img.src = imageDataUrl;
    });
  }

  // Effect pour la caméra
  $effect(() => {
    if (video && stream && appState === 'camera') {
      video.srcObject = stream;
      video.play().catch(err => console.error('Play error:', err));
    }
  });

  // Cleanup
  $effect(() => {
    return () => {
      if (browser && stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  });

  // Démarrer la caméra au chargement
  if (browser) {
    initCamera();
  }
</script>

<div class="app">
  <!-- Caméra plein écran -->
  {#if appState === 'camera'}
    <div class="camera-fullscreen">
      <!-- svelte-ignore a11y_missing_attribute -->
      <video bind:this={video} autoplay playsinline></video>
      <div class="center-line"></div>
      <canvas bind:this={canvas} class="hidden"></canvas>
      
      <button class="action-btn" onclick={startProcessing}>
        📸 Commencer
      </button>
    </div>
  {/if}

  <!-- Processing -->
  {#if appState === 'processing'}
    <div class="processing-screen">
      <div class="loader"></div>
      <h2>{statusMessage}</h2>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPercent}%"></div>
      </div>
      <p class="progress-text">{progressPercent}%</p>
    </div>
  {/if}

  <!-- Texte + Lecture -->
  {#if appState === 'ready' || appState === 'playing' || appState === 'paused'}
    <div class="result-screen">
      <div class="header">
        <h1>📖 Texte extrait</h1>
        <button class="btn-small" onclick={restart}>🔄 Recommencer</button>
      </div>

      <div class="text-display">
        <p>{extractedText}</p>
      </div>

      {#if statusMessage}
        <p class="status-small">{statusMessage}</p>
      {/if}

      {#if appState === 'ready'}
        <button class="action-btn" onclick={playAudio}>
          ▶️ Lire
        </button>
      {:else if appState === 'playing'}
        <button class="action-btn playing" onclick={pauseAudio}>
          ⏸️ Pause
        </button>
      {:else if appState === 'paused'}
        <button class="action-btn" onclick={playAudio}>
          ▶️ Reprendre
        </button>
      {/if}
    </div>
  {/if}

  <audio 
    bind:this={audioElement}
    onended={handleAudioEnd}
    class="hidden"
  ></audio>
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: #000;
  }

  .camera-fullscreen {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 40px;
  }

  video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .center-line {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    background: white;
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.8),
                0 0 16px rgba(255, 255, 255, 0.4);
    transform: translateX(-50%);
    z-index: 10;
  }

  .center-line::before,
  .center-line::after {
    content: '';
    position: absolute;
    left: 50%;
    width: 40px;
    height: 2px;
    background: white;
    transform: translateX(-50%);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
  }

  .center-line::before {
    top: 20%;
  }

  .center-line::after {
    bottom: 20%;
  }

  .action-btn {
    position: relative;
    z-index: 20;
    padding: 20px 60px;
    font-size: 24px;
    font-weight: 700;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 50px;
    cursor: pointer;
    box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
    transition: all 0.3s;
  }

  .action-btn:hover {
    transform: translateY(-3px) scale(1.05);
    box-shadow: 0 15px 50px rgba(102, 126, 234, 0.6);
  }

  .action-btn:active {
    transform: translateY(-1px) scale(1.02);
  }

  .action-btn.playing {
    background: linear-gradient(135deg, #F59E0B 0%, #EF4444 100%);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 10px 40px rgba(245, 158, 11, 0.4); }
    50% { box-shadow: 0 15px 50px rgba(245, 158, 11, 0.8); }
  }

  .processing-screen {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .loader {
    width: 80px;
    height: 80px;
    border: 8px solid rgba(255, 255, 255, 0.2);
    border-top: 8px solid white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 30px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .processing-screen h2 {
    font-size: 24px;
    margin-bottom: 30px;
    text-align: center;
  }

  .progress-bar {
    width: 100%;
    max-width: 400px;
    height: 8px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  .progress-fill {
    height: 100%;
    background: white;
    transition: width 0.3s;
    border-radius: 10px;
  }

  .progress-text {
    font-size: 20px;
    font-weight: 600;
  }

  .result-screen {
    width: 100%;
    height: 100%;
    background: white;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .header h1 {
    font-size: 24px;
    margin: 0;
  }

  .btn-small {
    padding: 10px 20px;
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 2px solid white;
    border-radius: 20px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
  }

  .btn-small:hover {
    background: white;
    color: #667eea;
  }

  .text-display {
    flex: 1;
    overflow-y: auto;
    padding: 30px;
    background: #F9FAFB;
  }

  .text-display p {
    line-height: 1.8;
    font-size: 18px;
    color: #374151;
    white-space: pre-wrap;
    max-width: 800px;
    margin: 0 auto;
  }

  .status-small {
    text-align: center;
    padding: 10px;
    color: #6B7280;
    font-size: 14px;
  }

  .result-screen .action-btn {
    margin: 20px auto 40px;
  }

  .hidden {
    display: none;
  }
</style>