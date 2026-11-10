import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { Flashlight, FlashlightOff, PencilLine, RefreshCw, ScanLine, Settings as SettingsIcon, SwitchCamera, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ScanResultBanner, type ScanBannerState } from './ScanResultBanner';

const DUPLICATE_WINDOW_MS = 2000;
const NATIVE_FORMATS = [
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Ean13,
  BarcodeFormat.Itf,
  BarcodeFormat.QrCode,
  BarcodeFormat.DataMatrix,
  BarcodeFormat.Pdf417,
];

type ScannerMode = 'nativeLive' | 'systemScanner' | 'web' | 'none';
type ScannerStatus = 'checking' | 'needPermission' | 'running' | 'denied' | 'unsupported' | 'pluginMissing' | 'noCamera';

export interface ScannerDiagnostics {
  platform: string;
  permission: string;
  pluginAvailable: boolean;
  usingFallback: boolean;
  scannerMode: ScannerMode;
  previewActive: boolean;
  lastError: string | null;
}

interface CardScannerProps {
  paused: boolean;
  banner?: ScanBannerState | null;
  onDetect: (text: string) => void;
  onManual: () => void;
  onClose: () => void;
  onDiagnostics?: (diag: ScannerDiagnostics) => void;
}

function setBodyScanning(active: boolean) {
  const el = document.documentElement;
  const body = document.body;
  if (active) {
    el.classList.add('barcode-scanner-active');
    body.classList.add('barcode-scanner-active');
  } else {
    el.classList.remove('barcode-scanner-active');
    body.classList.remove('barcode-scanner-active');
  }
}

// دالة تنظيف وتحليل النص الممسوح لتصحيح الفراغات وتوحيد المفاتيح
function parseCardPayload(rawText: string): string {
  if (!rawText) return rawText;
  
  const cleaned = rawText.trim();
  const parts = cleaned.split('|').map(p => p.trim());
  
  const data: Record<string, string> = {};
  parts.forEach(part => {
    const colonIndex = part.indexOf(':');
    if (colonIndex !== -1) {
      const key = part.substring(0, colonIndex).trim();
      const value = part.substring(colonIndex + 1).trim();
      data[key] = value;
    }
  });

  // إذا تم العثور على المعرف التسلسلي أو الرقم الوطني، نقوم بإعادة بناء النص بالصيغة القياسية السليمة
  const nin = data['NIN'] || '';
  const name = data['اسم'] || '';
  const decision = data['قرار'] || '';
  const sn = data['SN'] || data['SN '] || '';
  const sig = data['sig'] || '';

  if (nin || sn) {
    return `NIN:${nin}|اسم:${name}|قرار:${decision}|SN:${sn}|sig:${sig}`;
  }

  return cleaned;
}

export function CardScanner({ paused, banner, onDetect, onManual, onClose, onDiagnostics }: CardScannerProps) {
  const { t } = useTranslation();
  const isNative = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<ScannerStatus>('checking');
  const [mode, setMode] = useState<ScannerMode>('none');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [permissionVersion, setPermissionVersion] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [systemScanResult, setSystemScanResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pausedRef = useRef(paused);
  const onDetectRef = useRef(onDetect);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const zxingReaderRef = useRef<unknown>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const nativeListenersRef = useRef<PluginListenerHandle[]>([]);
  const backHandlerRef = useRef<PluginListenerHandle | null>(null);
  const scanningRef = useRef(false);
  const startingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    pausedRef.current = paused;
    onDetectRef.current = onDetect;
  }, [paused, onDetect]);

  const emit = useCallback((text: string) => {
    const parsedValue = parseCardPayload(text);
    const value = parsedValue.trim();
    if (!value || pausedRef.current) return;
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.text === value && now - last.at < DUPLICATE_WINDOW_MS) return;
    lastRef.current = { text: value, at: now };
    onDetectRef.current(value);
  }, []);

  const reportDiagnostics = useCallback((diag: Partial<ScannerDiagnostics>) => {
    if (onDiagnostics) {
      onDiagnostics({
        platform: isNative ? 'native' : 'web',
        permission: status === 'running' ? 'granted' : status === 'denied' ? 'denied' : status === 'needPermission' ? 'prompt' : 'unknown',
        pluginAvailable: !usingFallback,
        usingFallback,
        scannerMode: mode,
        previewActive: scanningRef.current && mode !== 'systemScanner',
        lastError: lastError,
        ...diag,
      });
    }
  }, [isNative, status, usingFallback, mode, lastError, onDiagnostics]);

  const stopNativeScan = useCallback(async () => {
    if (startingRef.current) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!startingRef.current) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }
    scanningRef.current = false;
    setBodyScanning(false);
    for (const listener of nativeListenersRef.current) {
      await listener.remove().catch(() => undefined);
    }
    nativeListenersRef.current = [];
    await BarcodeScanner.removeAllListeners().catch(() => undefined);
    await BarcodeScanner.stopScan().catch(() => undefined);
  }, []);

  const closeScanner = useCallback(() => {
    void stopNativeScan();
    if (backHandlerRef.current) {
      void backHandlerRef.current.remove().catch(() => undefined);
      backHandlerRef.current = null;
    }
    onCloseRef.current();
  }, [stopNativeScan]);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;

    const startNativeLive = async () => {
      while (startingRef.current) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        if (cancelled) return;
      }
      if (cancelled) return;
      startingRef.current = true;

      try {
        const scanListener = await BarcodeScanner.addListener('barcodesScanned', (event) => {
          const value = event.barcodes[0]?.rawValue;
          if (value) emit(value);
        });
        const errorListener = await BarcodeScanner.addListener('scanError', (event) => {
          setLastError(event.message);
        });
        nativeListenersRef.current = [scanListener, errorListener];

        setBodyScanning(true);
        scanningRef.current = true;

        await BarcodeScanner.startScan({
          formats: NATIVE_FORMATS,
          lensFacing: facing === 'user' ? LensFacing.Front : LensFacing.Back,
        });

        const torch = await BarcodeScanner.isTorchAvailable();
        if (!cancelled) setTorchAvailable(torch.available);
        if (!cancelled) {
          setStatus('running');
          setMode('nativeLive');
          setUsingFallback(false);
          setLastError(null);
        }
      } finally {
        startingRef.current = false;
      }
    };

    const tryNativeOrFallback = async () => {
      try {
        const current = await BarcodeScanner.checkPermissions();
        if (cancelled) return;
        if (current.camera === 'granted') {
          await startNativeLive();
        } else {
          setStatus('needPermission');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLastError(msg);
        setStatus('pluginMissing');
        await startWebFallback();
      }
    };

    (async () => {
      await tryNativeOrFallback();
    })().catch(async (err) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      await startWebFallback();
    });

    if (Capacitor.isNativePlatform()) {
      const appBridge = Capacitor as unknown as {
        App?: { addListener: (event: string, cb: () => void) => Promise<PluginListenerHandle> };
      };
      appBridge.App?.addListener('backButton', () => {
        void closeScanner();
      }).then((handle: PluginListenerHandle) => {
        if (cancelled) {
          void handle.remove().catch(() => undefined);
        } else {
          backHandlerRef.current = handle;
        }
      }).catch(() => undefined);
    }

    return () => {
      cancelled = true;
      void stopNativeScan();
      if (backHandlerRef.current) {
        void backHandlerRef.current.remove().catch(() => undefined);
        backHandlerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, facing, permissionVersion]);

  useEffect(() => {
    return () => {
      setBodyScanning(false);
    };
  }, []);

  const startWebFallback = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      setStatus('denied');
      return;
    }
    const track = stream.getVideoTracks()[0] ?? null;
    if (!track) {
      setLastError('No video track');
      setStatus('noCamera');
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    trackRef.current = track;
    const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
    setTorchAvailable(Boolean(capabilities.torch));

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    setUsingFallback(true);
    setMode('web');
    setStatus('running');
    setLastError(null);

    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (result) emit(result.getText());
      });
      zxingControlsRef.current = controls;
    } catch {
      const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (Detector) {
        const detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'pdf_417'] });
        const timer = window.setInterval(() => {
          const src = videoRef.current;
          if (!src || src.readyState < 2) return;
          detector.detect(src).then((codes) => {
            const value = codes[0]?.rawValue;
            if (value) emit(value);
          }).catch(() => undefined);
        }, 200);
        zxingControlsRef.current = { stop: () => window.clearInterval(timer) };
      }
    }
  };

  useEffect(() => {
    if (isNative) return;
    let cancelled = false;

    (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      } catch (err) {
        if (cancelled) return;
        setLastError(err instanceof Error ? err.message : String(err));
        setStatus('denied');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const track = stream.getVideoTracks()[0] ?? null;
      if (!track) {
        if (!cancelled) { setLastError('No video track'); setStatus('noCamera'); }
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      trackRef.current = track;
      const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchAvailable(Boolean(capabilities.torch));
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      if (!cancelled) { setStatus('running'); setMode('web'); setLastError(null); }

      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        zxingReaderRef.current = reader;
        const controls = await reader.decodeFromVideoDevice(undefined, video!, (result) => {
          if (result) emit(result.getText());
        });
        zxingControlsRef.current = controls;
      } catch {
        const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (Detector) {
          const detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'pdf_417'] });
          const timer = window.setInterval(() => {
            const src = videoRef.current;
            if (!src || src.readyState < 2) return;
            detector.detect(src).then((codes) => {
              const value = codes[0]?.rawValue;
              if (value) emit(value);
            }).catch(() => undefined);
          }, 200);
          zxingControlsRef.current = { stop: () => window.clearInterval(timer) };
        }
      }
    })();

    return () => {
      cancelled = true;
      zxingControlsRef.current?.stop();
      zxingControlsRef.current = null;
      zxingReaderRef.current = null;
      trackRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, facing]);

  useEffect(() => {
    reportDiagnostics({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lastError, usingFallback, mode]);

  const requestNativePermission = async () => {
    try {
      const result = await BarcodeScanner.requestPermissions();
      if (result.camera === 'granted') {
        setPermissionVersion((value) => value + 1);
      } else {
        setStatus('denied');
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setStatus('denied');
    }
  };

  const toggleTorch = async () => {
    const next = !torchOn;
    if (isNative && !usingFallback && mode === 'nativeLive') {
      try {
        await BarcodeScanner.toggleTorch();
      } catch { /* ignore */ }
    } else {
      const track = trackRef.current;
      if (!track) return;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
    setTorchOn(next);
  };

  const switchCamera = () => {
    setTorchOn(false);
    if (mode === 'nativeLive') {
      void stopNativeScan().then(() => {
        setFacing((value) => (value === 'environment' ? 'user' : 'environment'));
      });
    } else {
      zxingControlsRef.current?.stop();
      zxingControlsRef.current = null;
      setFacing((value) => (value === 'environment' ? 'user' : 'environment'));
    }
  };

  const runSystemScan = async () => {
    try {
      const googleModule = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!googleModule.available) {
        setLastError(t('canteen.scanner.googleModuleMissing'));
        return;
      }
      setMode('systemScanner');
      setStatus('running');
      setLastError(null);
      setSystemScanResult(null);
      const result = await BarcodeScanner.scan({ formats: NATIVE_FORMATS });
      const value = result.barcodes[0]?.rawValue;
      if (value) {
        const parsed = parseCardPayload(value);
        setSystemScanResult(parsed);
        emit(value);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('user')) {
        return;
      }
      setLastError(msg);
    }
  };

  const switchToSystemScanner = async () => {
    await stopNativeScan();
    setUsingFallback(false);
    await runSystemScan();
  };

  const switchToNativeLive = async () => {
    setSystemScanResult(null);
    setPermissionVersion((value) => value + 1);
  };

  const isNativeLive = isNative && !usingFallback && mode === 'nativeLive';
  const isSystemMode = mode === 'systemScanner';
  const overlayClass = isNativeLive ? 'bg-transparent' : 'bg-neutral-950';
  const showErrorButtons = status === 'denied' || status === 'unsupported' || status === 'pluginMissing' || status === 'noCamera';

  const overlay = (
    <div ref={overlayRef} className={`scanner-overlay fixed inset-0 z-50 flex flex-col text-white ${overlayClass}`}>
      {(!isNative || usingFallback || mode === 'web') && !isSystemMode ? (
        <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : null}

      <div className="relative z-10 flex items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={closeScanner}
          aria-label={t('canteen.scanner.close')}
          className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
        >
          <X className="size-7" aria-hidden />
        </button>
        <div className="flex gap-3">
          {isNative && !isSystemMode ? (
            <button
              type="button"
              onClick={switchToSystemScanner}
              aria-label={t('canteen.scanner.systemScanner')}
              className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
            >
              <ScanLine className="size-7" aria-hidden />
            </button>
          ) : null}
          {isSystemMode ? (
            <button
              type="button"
              onClick={switchToNativeLive}
              aria-label={t('canteen.scanner.nativeLive')}
              className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
            >
              <Flashlight className="size-7" aria-hidden />
            </button>
          ) : null}
          {torchAvailable && !isSystemMode ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? t('canteen.scanner.torchOff') : t('canteen.scanner.torchOn')}
              aria-pressed={torchOn}
              className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
            >
              {torchOn ? <FlashlightOff className="size-7" aria-hidden /> : <Flashlight className="size-7" aria-hidden />}
            </button>
          ) : null}
          {!isSystemMode ? (
            <button
              type="button"
              onClick={switchCamera}
              aria-label={t('canteen.scanner.switchCamera')}
              className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
            >
              <SwitchCamera className="size-7" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6">
        {status === 'running' && !isSystemMode ? (
          <>
            <div className="aspect-[3/2] w-full max-w-sm rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <p className="rounded-full bg-black/60 px-4 py-2 text-center text-base">{t('canteen.scanner.hint')}</p>
            {usingFallback ? (
              <p className="rounded-full bg-warning-600/80 px-4 py-1 text-center text-xs">{t('canteen.scanner.fallbackActive')}</p>
            ) : null}
          </>
        ) : null}

        {banner ? <ScanResultBanner banner={banner} /> : null}

        {isSystemMode ? (
          <div className="flex w-full max-w-sm flex-col gap-4">
            <p className="text-center text-base text-white/90">{t('canteen.scanner.systemScannerHint')}</p>
            {systemScanResult ? (
              <div className="rounded-2xl bg-white/10 p-4 text-center">
                <p className="text-sm text-white/70">{t('canteen.scanner.lastCode')}</p>
                <p className="font-mono text-lg font-bold text-white">{systemScanResult}</p>
              </div>
            ) : null}
            <Button fullWidth onClick={runSystemScan} className="min-h-14 text-base">
              <ScanLine className="size-5" aria-hidden />
              {t('canteen.scanner.scanNext')}
            </Button>
          </div>
        ) : null}

        {status === 'checking' ? <p className="text-lg">{t('canteen.scanner.starting')}</p> : null}
        {status === 'needPermission' ? (
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-neutral-900">
            <h2 className="text-lg font-bold">{t('canteen.scanner.permissionTitle')}</h2>
            <p className="text-base text-neutral-700">{t('canteen.scanner.permissionBody')}</p>
            <Button fullWidth onClick={requestNativePermission}>
              {t('canteen.scanner.allowCamera')}
            </Button>
          </div>
        ) : null}
        {showErrorButtons ? (
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-neutral-900">
            <h2 className="text-lg font-bold text-danger-700">
              {status === 'denied' ? t('canteen.scanner.permissionDenied')
                : status === 'pluginMissing' ? t('canteen.scanner.pluginMissing')
                : status === 'noCamera' ? t('canteen.scanner.noCamera')
                : t('canteen.scanner.unsupported')}
            </h2>
            {lastError ? (
              <p className="text-sm font-mono text-neutral-500 break-words">{lastError}</p>
            ) : null}
            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={() => { setLastError(null); setStatus('checking'); if (isNative) setPermissionVersion(v => v + 1); }}>
                <RefreshCw className="size-4" aria-hidden />
                {t('canteen.scanner.tryAgain')}
              </Button>
              <Button fullWidth onClick={() => { if (isNative) void BarcodeScanner.openSettings().catch(() => undefined); }}>
                <SettingsIcon className="size-4" aria-hidden />
                {t('canteen.scanner.openSettings')}
              </Button>
            </div>
            {isNative ? (
              <Button variant="ghost" fullWidth onClick={switchToSystemScanner}>
                <ScanLine className="size-4" aria-hidden />
                {t('canteen.scanner.systemScanner')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative z-10 p-4">
        <button
          type="button"
          onClick={onManual}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-neutral-900 transition active:scale-[0.98]"
        >
          <PencilLine className="size-5" aria-hidden />
          {t('canteen.scanner.manual')}
        </button>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
