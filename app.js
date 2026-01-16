// REGISTER SERVICE WORKER (Agar bisa jalan Offline)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Aplikasi siap offline'))
            .catch(err => console.log('Gagal register SW', err));
    });
}

let gudang = JSON.parse(localStorage.getItem('gudang_data')) || [];
let riwayat = JSON.parse(localStorage.getItem('riwayat_transaksi')) || [];
let pelanggan = JSON.parse(localStorage.getItem('pelanggan_data')) || [];
let pendingCarts = JSON.parse(localStorage.getItem('pending_carts')) || [];
let stockLog = JSON.parse(localStorage.getItem('stock_log')) || [];
let currentUser = { id: 'OWNER', nama: 'Owner', role: 'admin' }; // Langsung set sebagai Owner
let absensiLog = JSON.parse(localStorage.getItem('absensi_log')) || []; // [BARU] Log Absensi
let pengeluaran = JSON.parse(localStorage.getItem('pengeluaran_data')) || []; // [BARU] Data Pengeluaran
let vouchers = JSON.parse(localStorage.getItem('vouchers_data')) || []; // [BARU] Data Voucher
let settings = JSON.parse(localStorage.getItem('app_settings')) || { targetOmzet: 500000, memberLevels: { silver: { pts: 100, disc: 5 }, gold: { pts: 500, disc: 10 } } }; // [BARU] App Settings
let mejaData = JSON.parse(localStorage.getItem('meja_data')) || Array.from({length: 9}, (_, i) => ({ id: i+1, status: 'kosong', pesanan: [] })); // [BARU] Data Meja (Default 9 meja)
let activeTableId = null; // Meja yang sedang aktif/dipilih
let cart = JSON.parse(localStorage.getItem('current_cart')) || []; // [BARU] Load cart dari storage
let remainingCartItems = []; // [BARU] Untuk split bill retail
let tempCart = []; // Penampung scan sementara
let scanner = null;
let scannerStok = null;
let tempSku = '';
let lastScanCode = null;
let lastScanTime = 0;
let currentTrack = null;
let barcodeBuffer = "";
let barcodeTimer;
let settingPajak = parseFloat(localStorage.getItem('setting_pajak')) || 0;
let tempImageData = null; // [BARU] Penampung data gambar base64 sementara
let metodePembayaran = 'tunai'; // tunai | nontunai
let stokLimit = 20; // Batas render awal untuk performa
let kasirMode = 'retail'; // 'retail' | 'resto'
let profilToko = JSON.parse(localStorage.getItem('profil_toko')) || {
    nama: 'KASIR PINTAR PRO',
    alamat: 'Jl. Raya Bisnis No. 1',
    nohp: '0812-3456-7890',
    footer: 'Terima Kasih atas Kunjungan Anda',
    infoBayar: '',
    happyHour: { start: '', end: '', percent: 0 }
};
let isProcessingPay = false; // [BARU] Flag untuk mencegah double submit

// --- PWA INSTALL PROMPT ---
let deferredPrompt;
const installContainer = document.getElementById('install-prompt-container');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installContainer.classList.remove('hidden');
  installContainer.classList.add('flex');
});

function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('Aplikasi berhasil diinstal!', 'success');
        installContainer.classList.add('hidden');
      }
      deferredPrompt = null;
    });
  }
}

// [BARU] Image Handler
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 300;
            const MAX_HEIGHT = 300;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            if (dataUrl.length > 2 * 1024 * 1024) { // Batas 2MB per gambar
                return showToast("Ukuran gambar terlalu besar setelah kompresi!", "error");
            }
            document.getElementById('f-gambar-preview').src = dataUrl;
            tempImageData = dataUrl;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- PAGE VISIBILITY API & NETWORK STATUS ---
// Fitur profesional untuk mengelola state aplikasi
const updateNetworkStatus = () => {
    const statusDot = document.getElementById('network-status');
    if (!statusDot) return;
    if (navigator.onLine) {
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('bg-green-500');
        statusDot.title = 'Online';
    } else {
        statusDot.classList.remove('bg-green-500');
        statusDot.classList.add('bg-red-500');
        statusDot.title = 'Offline';
        showToast('Koneksi internet terputus, aplikasi beralih ke mode offline.', 'info');
    }
};

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// Hentikan kamera saat app tidak aktif untuk hemat baterai & privasi
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopSemuaKamera();
    }
});

// TOAST NOTIFICATION
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerText = msg;
    
    if(type === 'error') el.style.background = 'rgba(220, 38, 38, 0.9)';
    else if(type === 'success') el.style.background = 'rgba(13, 148, 136, 0.9)'; // teal-600
    else el.style.background = 'rgba(50, 50, 50, 0.9)';
    
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// --- UTILITIES ---
const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

// Helper Escape HTML (Keamanan XSS)
const escapeHtml = (text) => {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Helper Format Rupiah
const formatRupiah = (val) => 'Rp ' + parseInt(val || 0).toLocaleString('id-ID');

// [BARU] Helper Jam Digital
function updateClock() {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;
    const now = new Date();
    const timeString = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateString = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
    clockEl.innerHTML = `${dateString}, <span class="font-mono">${timeString}</span>`;
}

// [BARU] Audio Beep untuk Scan
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

// KEYBOARD LISTENER (USB SCANNER & SHORTCUTS)
document.addEventListener('keydown', (e) => {
    // Shortcuts
    if(e.key === 'F2') { e.preventDefault(); toggleSearch(); return; }
    if(e.key === 'F4' && document.getElementById('p-kasir').classList.contains('active')) { e.preventDefault(); bayarSekarang(); return; }
    if(e.key === 'F8' && !document.getElementById('modal-bayar').classList.contains('hidden')) { e.preventDefault(); document.getElementById('input-uang').focus(); return; }
    
    const activeModal = document.querySelector('#modal-tambah-produk:not(.hidden), #modal-bayar:not(.hidden), #modal-tambah-pelanggan:not(.hidden)');

    // USB Scanner Logic
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Enter' && !document.getElementById('modal-bayar').classList.contains('hidden')) {
            prosesPembayaranFinal();
        }
        return;
    }

    if (e.key === 'Enter') {
        if (barcodeBuffer.length > 0) {
            // Cegah scan jika ada modal terbuka agar tidak mengacaukan state
            if (document.querySelector('.modal:not(.hidden), #modal-bayar:not(.hidden), #modal-split-bill:not(.hidden)')) { barcodeBuffer = ""; return; }
            
            if (document.getElementById('p-kasir').classList.contains('active')) {
                handleScanKasir(barcodeBuffer);
            } else if (document.getElementById('p-stok').classList.contains('active')) {
                document.getElementById('f-sku').value = barcodeBuffer;
                openModalTambahProduk();
            }
            barcodeBuffer = "";
        }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimer);
        barcodeTimer = setTimeout(() => barcodeBuffer = "", 100); // Increased timeout for slower scanners
    }
});

async function stopSemuaKamera() {
    if(scanner) {
        try {
            if(scanner.isScanning) await scanner.stop();
            scanner.clear();
        } catch(e) { console.log("Stop camera error", e); }
        scanner = null;
    }
}

// KAMERA ENGINE
function startKamera() {
    document.getElementById('camera-prompt').style.display = 'none';
    if (!scanner) {
        scanner = new Html5Qrcode("reader");
    }
    
    const config = { 
        fps: 20, 
        // Menambahkan aspek rasio standar (4:3) untuk menghindari lensa ultra-wide
        aspectRatio: 1.333334
    };
    
    const onCameraReady = () => {
        const videoEl = document.querySelector('#reader video');
        const track = (videoEl && videoEl.srcObject) ? videoEl.srcObject.getVideoTracks()[0] : null;
        
        if (!track) return;
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        const camControls = document.getElementById('cam-controls');
        
        camControls.classList.remove('hidden');
        camControls.classList.add('flex');

        if (capabilities.zoom) {
            const zoomBox = document.getElementById('zoom-box');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomValue = document.getElementById('zoom-value');
            zoomBox.classList.remove('hidden');
            zoomSlider.min = capabilities.zoom.min;
            zoomSlider.max = capabilities.zoom.max;
            zoomSlider.step = capabilities.zoom.step;
            
            zoomSlider.oninput = () => {
                const val = zoomSlider.value;
                zoomValue.innerText = parseFloat(val).toFixed(1) + 'x';
                track.applyConstraints({ advanced: [{ zoom: val }] });
            };
        }

        if (capabilities.torch) {
            document.getElementById('btn-flash').classList.remove('hidden');
        }
    };

    try {
        if (scanner.getState() === 2) return; // 2 = SCANNING
    } catch(e) {}

    Html5Qrcode.getCameras().then(cameras => {
        let selectedCameraId = null;
        if (cameras && cameras.length > 0) {
            const backCameras = cameras.filter(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('belakang'));
            if (backCameras.length > 0) {
                const mainCamera = backCameras.find(c => {
                    const label = c.label.toLowerCase();
                    const isUltraWide = label.includes('ultra') || (label.includes('wide') && (label.includes('0.5') || label.includes('0.6')));
                    const isSpecial = label.includes('tele') || label.includes('macro') || label.includes('depth') || label.includes('virtual');
                    return (label.includes('0') || label.includes('main') || label.includes('primary')) && !isUltraWide && !isSpecial;
                });
                selectedCameraId = mainCamera ? mainCamera.id : (backCameras.find(c => !c.label.toLowerCase().includes('ultra'))?.id || backCameras[0].id);
            }
        }

        const constraints = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: "environment" };

        scanner.start(constraints, config, (decodedText) => {
            const now = Date.now();
            if (decodedText === lastScanCode && (now - lastScanTime < 2000)) return;
            lastScanCode = decodedText;
            lastScanTime = now;
            handleScanKasir(decodedText);
            if(navigator.vibrate) navigator.vibrate(70);
            tutupModalScanner();
        })
        .then(onCameraReady)
        .catch(err => {
            console.error("Gagal start kamera, mencoba fallback", err);
            scanner.start({ facingMode: "environment" }, config, (decodedText) => handleScanKasir(decodedText))
            .then(onCameraReady)
            .catch(e => {
                showToast("Gagal akses kamera.", "error");
                tutupModalScanner();
            });
        });
    }).catch(err => {
        console.error("Gagal mendapatkan daftar kamera", err);
        scanner.start({ facingMode: "environment" }, config, (decodedText) => handleScanKasir(decodedText))
        .then(onCameraReady)
        .catch(() => { showToast("Gagal akses kamera", "error"); tutupModalScanner(); });
    });
}

// FLASH TOGGLE
let isFlashOn = false;
function toggleFlash() {
    const videoEl = document.querySelector('#reader video');
    if(videoEl && videoEl.srcObject) {
        const track = videoEl.srcObject.getVideoTracks()[0];
        if(track) {
            isFlashOn = !isFlashOn;
            track.applyConstraints({ advanced: [{ torch: isFlashOn }] })
            .catch(e => console.log(e));
            
            // Visual feedback button
            const btn = document.getElementById('btn-flash');
            if(isFlashOn) btn.classList.add('text-yellow-400');
            else btn.classList.remove('text-yellow-400');
        }
    }
}

// SCANNER STOK
function bukaScannerStok() {
    const box = document.getElementById('box-scanner-stok');
    box.classList.remove('hidden');
    
    if (!scannerStok) {
        scannerStok = new Html5Qrcode("reader-stok");
    }

    scannerStok.start({ facingMode: "environment" }, { fps: 10 }, (decodedText) => {
        document.getElementById('f-sku').value = decodedText;
        if(navigator.vibrate) navigator.vibrate(70);
        tutupScannerStok();
        document.getElementById('f-nama').focus();
    }).catch(err => {
        showToast("Gagal buka kamera stok", "error");
        box.classList.add('hidden');
    });
}

function tutupScannerStok() {
    if(scannerStok && scannerStok.isScanning) {
        scannerStok.stop().then(() => {
            document.getElementById('box-scanner-stok').classList.add('hidden');
        }).catch(err => {
            document.getElementById('box-scanner-stok').classList.add('hidden');
        });
    } else {
        document.getElementById('box-scanner-stok').classList.add('hidden');
    }
}

// NAVIGASI HALAMAN
function bukaHalaman(nama, mode = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('p-' + nama).classList.add('active');
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if(document.getElementById('nav-' + nama)) document.getElementById('nav-' + nama).classList.add('active');
    
    // Update Sidebar Active State
    document.querySelectorAll('.nav-item-desktop').forEach(b => {
        b.classList.remove('bg-teal-50', 'text-teal-600');
        if(b.id === 'desk-nav-' + nama) b.classList.add('bg-teal-50', 'text-teal-600');
    });

    // Special case for kasir sub-modes
    if(nama === 'kasir') document.getElementById('desk-nav-kasir').classList.add('bg-teal-50', 'text-teal-600');


    const fab = document.getElementById('fab-tambah-produk');
    if (nama === 'stok') {
        fab.classList.remove('hidden');
        stokLimit = 20; // Reset limit saat buka halaman stok
        renderKategoriFilter();
        renderStok();
    } else {
        fab.classList.add('hidden');
    }

    if (nama === 'dashboard') {
        renderDashboard();
    }

    updateBadgePending();
    if (nama === 'pelanggan') {
        renderPelanggan();
    }

    if(nama === 'laporan') renderLaporan();

    if(nama === 'kasir') {
        if(mode) {
            switchKasirMode(mode);
        }

        // Update setting pajak di UI saat masuk halaman pengaturan/kasir
        if(document.getElementById('setting-pajak')) {
            document.getElementById('setting-pajak').value = settingPajak;
        }
        // Update dropdown pelanggan
        const selectPel = document.getElementById('pilih-pelanggan');
        selectPel.innerHTML = '<option value="">Umum (Non-Member)</option>' + 
            pelanggan.map(p => `<option value="${p.id}">${p.nama}</option>`).join('');
        
        renderMenuKategori();
        renderMenuGrid();
    } else {
        stopSemuaKamera();
    }

    if(nama !== 'stok') {
        tutupScannerStok();
    }

    if(nama === 'absensi') {
        startKameraAbsensi();
        renderRiwayatAbsensi();
    }

    if(nama === 'barcode') {
        renderListProdukBarcode();
        generateBarcode();
    }

    if(nama === 'pengeluaran') {
        renderPengeluaran();
    }

    if(nama === 'hutang') {
        renderHutang();
    }

    if(nama === 'meja') {
        renderMeja();
    }
    
    // Update Profil Toko di Pengaturan
    if(nama === 'pengaturan') {
        document.getElementById('set-nama-toko').value = profilToko.nama;
        document.getElementById('set-alamat-toko').value = profilToko.alamat;
        document.getElementById('set-nohp-toko').value = profilToko.nohp;
        document.getElementById('set-footer-struk').value = profilToko.footer;
        document.getElementById('set-info-bayar').value = profilToko.infoBayar || '';
        tutupScannerStok();
        // Load Happy Hour
        document.getElementById('hh-start').value = profilToko.happyHour?.start || '';
        document.getElementById('hh-end').value = profilToko.happyHour?.end || '';
        document.getElementById('hh-percent').value = profilToko.happyHour?.percent || '';
        // Load Vouchers
        renderVouchers();
        // Load Member Levels
        document.getElementById('level-silver-pts').value = settings.memberLevels.silver.pts;
        document.getElementById('level-silver-disc').value = settings.memberLevels.silver.disc;
        document.getElementById('level-gold-pts').value = settings.memberLevels.gold.pts;
        document.getElementById('level-gold-disc').value = settings.memberLevels.gold.disc;
    }
}

// [BARU] SWITCH MODE KASIR
function switchKasirMode(mode) {
    kasirMode = mode;
    const btnRetail = document.getElementById('btn-mode-retail');
    const btnResto = document.getElementById('btn-mode-resto');
    const viewRetail = document.getElementById('view-retail');
    const viewResto = document.getElementById('view-resto');

    if(mode === 'retail') {
        // Style Button
        btnRetail.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all bg-white text-teal-600 shadow-sm ring-2 ring-teal-500";
        btnResto.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all text-slate-500 hover:bg-slate-300";
        
        // View
        viewRetail.classList.remove('hidden');
        viewResto.classList.add('hidden');

        // Start Embedded Camera
        setTimeout(startKameraRetail, 300);
    } else {
        // Style Button
        btnResto.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all bg-white text-orange-600 shadow-sm ring-2 ring-orange-500";
        btnRetail.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all text-slate-500 hover:bg-slate-300";

        // View
        viewResto.classList.remove('hidden');
        viewRetail.classList.add('hidden');

        // Stop Camera
        stopSemuaKamera();
    }
}

async function startKameraRetail() {
    await stopSemuaKamera();
    if (!scanner) scanner = new Html5Qrcode("reader-retail");
    
    const config = { 
        fps: 20, 
        aspectRatio: 1.333334
    };

    Html5Qrcode.getCameras().then(cameras => {
        let selectedCameraId = null;
        if (cameras && cameras.length > 0) {
            const backCameras = cameras.filter(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('belakang'));
            if (backCameras.length > 0) {
                const mainCamera = backCameras.find(c => {
                    const label = c.label.toLowerCase();
                    const isUltraWide = label.includes('ultra') || (label.includes('wide') && (label.includes('0.5') || label.includes('0.6')));
                    const isSpecial = label.includes('tele') || label.includes('macro') || label.includes('depth') || label.includes('virtual');
                    return (label.includes('0') || label.includes('main') || label.includes('primary')) && !isUltraWide && !isSpecial;
                });
                selectedCameraId = mainCamera ? mainCamera.id : (backCameras.find(c => !c.label.toLowerCase().includes('ultra'))?.id || backCameras[0].id);
            }
        }

        const constraints = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: "environment" };

        scanner.start(constraints, config, (decodedText) => {
            const now = Date.now();
            if (decodedText === lastScanCode && (now - lastScanTime < 2000)) return;
            lastScanCode = decodedText;
            lastScanTime = now;
            handleScanKasir(decodedText);
            if(navigator.vibrate) navigator.vibrate(70);
        }).catch(err => console.log("Kamera retail error/stop", err));
    }).catch(err => {
        console.error("Gagal akses kamera retail", err);
        scanner.start({ facingMode: "environment" }, config, (decodedText) => {
            const now = Date.now();
            if (decodedText === lastScanCode && (now - lastScanTime < 2000)) return;
            lastScanCode = decodedText;
            lastScanTime = now;
            handleScanKasir(decodedText);
            if(navigator.vibrate) navigator.vibrate(70);
        });
    });
}

function toggleSearch() {
    const box = document.getElementById('search-box');
    box.classList.toggle('hidden');
    if(!box.classList.contains('hidden')) {
        document.getElementById('in-search').focus();
        document.getElementById('in-search').value = '';
        doSearch('');
    }
}

function doSearch(val) {
    const res = document.getElementById('res-search');
    if(val.length < 1) { res.innerHTML = "<p class='text-center text-gray-400 mt-8'>Mulai ketik untuk mencari produk...</p>"; return; }
    
    const filtered = gudang.filter(p => p.nama.toLowerCase().includes(val.toLowerCase()) || p.sku.includes(val));
    
    if(filtered.length === 0) { res.innerHTML = "<p class='text-center text-gray-400 mt-8'>Tidak ditemukan.</p>"; return; }

    res.innerHTML = filtered.map(p => `
        <div onclick="tambahKeCart('${p.sku}'); toggleSearch();" class="flex justify-between items-center cursor-pointer hover:bg-teal-50 p-3 rounded-xl border border-slate-100">
            <div>
                <b class="text-slate-800">${escapeHtml(p.nama)}</b><br>
                <small class="text-gray-500">${escapeHtml(p.sku)} ${p.kategori ? '• ' + escapeHtml(p.kategori) : ''}</small>
            </div>
            <div class="text-teal-600 font-bold">Rp ${parseInt(p.harga).toLocaleString()}</div>
        </div>
    `).join('');
}

// --- MODAL PRODUK ---
function openModalTambahProduk(skuToEdit = null) {
    const modal = document.getElementById('modal-tambah-produk');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Reset form
    document.getElementById('f-sku').value = '';
    document.getElementById('f-nama').value = '';
    document.getElementById('f-harga').value = '';
    document.getElementById('f-modal').value = ''; // Reset modal
    document.getElementById('f-kategori').value = '';
    document.getElementById('f-stok').value = '';
    document.getElementById('f-sku').disabled = false;
    document.getElementById('f-gambar-preview').src = 'https://via.placeholder.com/150x150.png?text=Pilih+Gambar';
    tempImageData = null;

    if (skuToEdit) {
        const produk = gudang.find(p => p.sku === skuToEdit);
        if (produk) {
            document.getElementById('f-sku').value = produk.sku;
            document.getElementById('f-nama').value = produk.nama;
            document.getElementById('f-harga').value = produk.harga;
            document.getElementById('f-modal').value = produk.modal || ''; // Load modal
            document.getElementById('f-kategori').value = produk.kategori || '';
            document.getElementById('f-stok').value = produk.stok;
            document.getElementById('f-sku').disabled = true; // SKU tidak bisa diubah
            if (produk.gambar) {
                document.getElementById('f-gambar-preview').src = produk.gambar;
                tempImageData = produk.gambar;
            }
        }
    }
    // Populate datalist for category autocomplete
    const kategoriList = document.getElementById('kategori-list');
    const semuaKategori = [...new Set(gudang.map(p => p.kategori).filter(Boolean))];
    kategoriList.innerHTML = semuaKategori.map(k => `<option value="${k}"></option>`).join('');

    setTimeout(() => document.getElementById(skuToEdit ? 'f-nama' : 'f-sku').focus(), 100);
}

function closeModalTambahProduk() {
    const modal = document.getElementById('modal-tambah-produk');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    tutupScannerStok();
}

// CORE LOGIC
function simpanProduk() {
    const sku = document.getElementById('f-sku').value;
    const nama = document.getElementById('f-nama').value;
    const harga = parseInt(document.getElementById('f-harga').value) || 0;
    const modal = parseInt(document.getElementById('f-modal').value) || 0;
    const kategori = document.getElementById('f-kategori').value.trim();
    const stok = parseInt(document.getElementById('f-stok').value) || 0;
    const gambar = tempImageData;

    if(!sku || !nama) return showToast("Data SKU dan Nama wajib diisi!", "error");
    if(harga < 0 || modal < 0 || stok < 0) return showToast("Harga, Modal, dan Stok tidak boleh negatif!", "error");

    const index = gudang.findIndex(p => p.sku === sku);
    if(index > -1) {
        logStockChange(sku, nama, parseInt(stok) - gudang[index].stok, 'Edit Manual');
        gudang[index] = {sku, nama, harga, modal, kategori, stok, gambar};
    } else {
        gudang.push({sku, nama, harga, modal, kategori, stok, gambar});
        logStockChange(sku, nama, stok, 'Produk Baru');
    }

    localStorage.setItem('gudang_data', JSON.stringify(gudang));
    showToast("Produk Berhasil Disimpan", "success");
    renderStok();
    closeModalTambahProduk();
}

// FUNGSI SUARA (TEXT-TO-SPEECH)
let currentUtterance = null;

function ucapkan(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID';
        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
    }
}

document.addEventListener('click', function unlockAudio() {
    if ('speechSynthesis' in window && window.speechSynthesis.getVoices().length === 0) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
    document.removeEventListener('click', unlockAudio);
}, { once: true });

// LOGIK SCAN KASIR BARU
function handleScanKasir(sku) {
    const produk = gudang.find(p => p.sku === sku);
    if(!produk) {
        tempSku = sku;
        document.getElementById('txt-unknown-sku').innerText = sku;
        document.getElementById('modal-unknown').classList.remove('hidden');
        document.getElementById('modal-unknown').classList.add('flex');
        if(scanner) try { scanner.pause(); } catch(e){}
    } else {
        ucapkan(produk.nama);
        if (kasirMode === 'retail') {
            if(tambahKeCartCore(produk)) {
                renderCart();
                showToast(`${produk.nama} +1`, 'success');
            }
        } else {
            tempCart.unshift({
                ...produk,
                tempId: Date.now() + Math.random()
            });
            renderTempCart();
        }
    }
}

function renderTempCart() {
    const area = document.getElementById('temp-scan-area');
    const list = document.getElementById('temp-list');
    
    if(tempCart.length === 0) {
        area.classList.add('hidden');
        return;
    }
    
    area.classList.remove('hidden');
    list.innerHTML = tempCart.map((item, i) => `
        <div class="flex justify-between items-center bg-white p-3 rounded-xl border border-teal-100 temp-item shadow-sm">
            <div>
                <div class="font-bold text-sm text-teal-900">${escapeHtml(item.nama)}</div>
                <div class="text-[10px] text-gray-400">${escapeHtml(item.sku)}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="text-xs font-bold text-teal-600">Rp ${parseInt(item.harga).toLocaleString()}</span>
                <button onclick="hapusTemp(${i})" class="w-8 h-8 bg-red-50 text-red-500 rounded-full flex items-center justify-center font-bold text-xs hover:bg-red-100">✕</button>
            </div>
        </div>
    `).join('');
}

function hapusTemp(index) {
    tempCart.splice(index, 1);
    renderTempCart();
}

function batalTempSemua() {
    tempCart = [];
    renderTempCart();
}

function masukKeranjang() {
    tempCart.forEach(item => {
        tambahKeCartCore(item);
    });
    tempCart = [];
    renderTempCart();
    renderCart();
    if(navigator.vibrate) navigator.vibrate([50, 50, 50]);
}

function tambahKeCartCore(produk) {
    const index = cart.findIndex(c => c.sku === produk.sku);
    const produkGudang = gudang.find(g => g.sku === produk.sku);
    
    if (!produkGudang) {
        showToast("Produk tidak valid/dihapus", "error");
        return false;
    }

    if(index > -1) {
        const item = cart[index];
        // Cek stok gudang dengan aman (jika produk dihapus saat di keranjang)
        const maxStok = produkGudang.stok;
        if(item.qty < maxStok) {
            item.qty++;
            cart.splice(index, 1);
            cart.unshift(item);
            return true;
        } else {
            showToast(`Stok ${item.nama} habis (Sisa: ${maxStok})`, 'error');
            return false;
        }
    } else {
        if (produkGudang.stok > 0) {
            cart.unshift({...produk, harga: parseInt(produk.harga), qty: 1, diskon: 0 });
            return true;
        } else {
            showToast(`Stok ${produk.nama} habis!`, 'error');
            return false;
        }
    }
}

// MODAL UNKNOWN
function tutupModalUnknown() {
    document.getElementById('modal-unknown').classList.add('hidden');
    document.getElementById('modal-unknown').classList.remove('flex');
    if(scanner) try { scanner.resume(); } catch(e){}
}

function redirectKeStok() {
    tutupModalUnknown();
    bukaHalaman('stok');
    openModalTambahProduk();
    document.getElementById('f-sku').value = tempSku;
    document.getElementById('f-nama').focus();
}

// FUNGSI LAMA (Disesuaikan untuk Search Manual)
function tambahKeCart(sku) {
    const produk = gudang.find(p => p.sku === sku);
    if(!produk) return showToast("Produk tidak ditemukan", "error");
    if(tambahKeCartCore(produk)) {
        renderCart();
        showToast(`${produk.nama} ditambahkan`, 'success');
        playBeep();
    }
}

function renderCart() {
    const list = document.getElementById('cart-list');
    const totalEl = document.getElementById('total-harga');
    localStorage.setItem('current_cart', JSON.stringify(cart)); // [BARU] Simpan cart setiap render

    if(cart.length === 0) {
        list.innerHTML = `
            <div class="text-center py-10 text-gray-400">
                <svg class="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                <h3 class="mt-2 text-sm font-medium text-gray-500">Keranjang Kosong</h3>
                <p class="mt-1 text-sm text-gray-400">Scan produk atau cari untuk memulai transaksi.</p>
            </div>`;
    } else {
        list.innerHTML = cart.map((item, i) => {
            const hargaSetelahDiskon = item.harga - (item.diskon || 0);
            return `
                <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100 shadow-sm">
                    <div onclick="openModalEditItem(${i})" class="cursor-pointer flex-1">
                        <div class="font-bold text-gray-800">${escapeHtml(item.nama)}</div>
                        <div class="text-xs text-teal-600 font-bold mt-1">Rp ${hargaSetelahDiskon.toLocaleString()} ${item.diskon > 0 ? `<span class="text-red-400 line-through ml-1 text-[10px]">${item.harga.toLocaleString()}</span>` : ''}</div>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="updateQty(${i}, -1)" class="w-7 h-7 bg-white rounded-full shadow-sm text-slate-600 font-bold border border-slate-200 hover:bg-slate-100 flex items-center justify-center">-</button>
                        <span class="font-bold text-gray-800 w-6 text-center">${item.qty}</span>
                        <button onclick="updateQty(${i}, 1)" class="w-7 h-7 bg-teal-600 text-white rounded-full shadow-md font-bold hover:bg-teal-700 flex items-center justify-center">+</button>
                        <button onclick="hapusItemCart(${i})" class="text-red-400 hover:text-red-600 ml-1"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // Hitung total sementara untuk display di keranjang (belum termasuk pajak global)
    const subtotal = cart.reduce((sum, item) => sum + ((item.harga - (item.diskon || 0)) * item.qty), 0);
    
    // Cek Happy Hour untuk display
    const isHappyHour = checkHappyHour();
    if(isHappyHour) {
        totalEl.innerHTML = `<span class="text-xs text-purple-500 block">Happy Hour!</span>Rp ${subtotal.toLocaleString()}`;
    } else {
        totalEl.innerText = `Rp ${subtotal.toLocaleString()}`;
    }
}

function updateQty(i, n) {
    const item = cart[i];
    const newQty = item.qty + n;

    if (newQty > 0) {
        const produkGudang = gudang.find(g => g.sku === item.sku);
        // Jika produk hilang dari gudang, gunakan qty saat ini sebagai batas
        const maxStok = produkGudang ? produkGudang.stok : item.qty;
        
        if (newQty <= maxStok) {
            item.qty = newQty;
        } else {
            showToast(`Stok ${item.nama} hanya tersisa ${maxStok}`, 'error');
        }
    } else {
        cart.splice(i, 1);
    }
    renderCart();
}

// [BARU] Fungsi Hapus Item Langsung
function hapusItemCart(i) {
    cart.splice(i, 1);
    renderCart();
}

// --- HOLD / PENDING CART ---
function holdCart() {
    if(cart.length === 0) return showToast("Keranjang kosong!", "error");
    
    const note = prompt("Masukkan nama/catatan untuk pesanan ini:", "Pelanggan " + (pendingCarts.length + 1));
    if(note === null) return; // Cancel

    pendingCarts.push({
        id: Date.now(),
        note: note || "Tanpa Nama",
        date: new Date().toISOString(),
        items: [...cart]
    });
    
    localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
    cart = [];
    renderCart();
    updateBadgePending();
    showToast("Pesanan disimpan!", "success");
}

function updateBadgePending() {
    const badge = document.getElementById('badge-pending');
    if(pendingCarts.length > 0) {
        badge.innerText = pendingCarts.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function bukaModalPending() {
    const list = document.getElementById('list-pending');
    const empty = document.getElementById('empty-pending');
    
    if(pendingCarts.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        list.innerHTML = pendingCarts.map((p, i) => `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                <div onclick="recallCart(${i})" class="cursor-pointer flex-1">
                    <div class="font-bold text-slate-800">${escapeHtml(p.note)}</div>
                    <div class="text-xs text-slate-500">${new Date(p.date).toLocaleTimeString('id-ID')} • ${p.items.length} Item</div>
                </div>
                <button onclick="hapusPending(${i})" class="text-red-500 p-2 hover:bg-red-50 rounded-lg">✕</button>
            </div>
        `).join('');
    }
    
    document.getElementById('modal-pending').classList.remove('hidden');
    document.getElementById('modal-pending').classList.add('flex');
}

function tutupModalPending() {
    document.getElementById('modal-pending').classList.add('hidden');
    document.getElementById('modal-pending').classList.remove('flex');
}

function recallCart(index) {
    if(cart.length > 0 && !confirm("Keranjang saat ini tidak kosong. Timpa dengan pesanan yang disimpan?")) return;
    
    cart = [...pendingCarts[index].items];
    pendingCarts.splice(index, 1);
    localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
    
    renderCart();
    updateBadgePending();
    tutupModalPending();
    showToast("Pesanan dikembalikan ke keranjang", "success");
}

function hapusPending(index) {
    if(confirm("Hapus simpanan pesanan ini?")) {
        pendingCarts.splice(index, 1);
        localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
        bukaModalPending(); // Re-render
        updateBadgePending();
    }
}

// --- EDIT ITEM KERANJANG ---
function openModalEditItem(index) {
    const item = cart[index];
    document.getElementById('edit-index').value = index;
    document.getElementById('edit-qty').value = item.qty;
    document.getElementById('edit-diskon').value = item.diskon || 0;
    
    const modal = document.getElementById('modal-edit-item');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModalEditItem() {
    const modal = document.getElementById('modal-edit-item');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function simpanEditItem() {
    const index = parseInt(document.getElementById('edit-index').value);
    const qty = parseInt(document.getElementById('edit-qty').value);
    const diskon = parseInt(document.getElementById('edit-diskon').value) || 0;

    if(qty > 0) {
        cart[index].qty = qty;
        cart[index].diskon = diskon;
        renderCart();
        closeModalEditItem();
    } else {
        if(confirm("Hapus item ini?")) {
            cart.splice(index, 1);
            renderCart();
            closeModalEditItem();
        }
    }
}

// --- SPLIT BILL LOGIC ---
let splitSelection = []; // Array of indices from cart

function bukaModalSplitBill() {
    if(cart.length === 0) return showToast("Keranjang kosong!", "error");
    splitSelection = [];
    renderSplitList();
    document.getElementById('modal-split-bill').classList.remove('hidden');
    document.getElementById('modal-split-bill').classList.add('flex');
}

function tutupModalSplitBill() {
    document.getElementById('modal-split-bill').classList.add('hidden');
    document.getElementById('modal-split-bill').classList.remove('flex');
}

function toggleSplitItem(index) {
    if(splitSelection.includes(index)) {
        splitSelection = splitSelection.filter(i => i !== index);
    } else {
        splitSelection.push(index);
    }
    renderSplitList();
}

function renderSplitList() {
    const list = document.getElementById('list-split-bill');
    let totalSplit = 0;
    
    list.innerHTML = cart.map((item, i) => {
        const isSelected = splitSelection.includes(i);
        const sub = (item.harga - (item.diskon || 0)) * item.qty;
        if(isSelected) totalSplit += sub;
        
        return `
        <div onclick="toggleSplitItem(${i})" class="flex justify-between items-center p-3 rounded-xl border cursor-pointer transition ${isSelected ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200'}">
            <div>
                <div class="font-bold text-sm text-slate-800">${escapeHtml(item.nama)}</div>
                <div class="text-xs text-slate-500">${item.qty} x ${item.harga.toLocaleString()}</div>
            </div>
            <div class="font-bold text-teal-600">Rp ${sub.toLocaleString()}</div>
        </div>`;
    }).join('');
    
    document.getElementById('total-split').innerText = `Rp ${totalSplit.toLocaleString()}`;
}

function prosesSplitBill() {
    if(splitSelection.length === 0) return showToast("Pilih item dulu!", "error");
    
    // Buat cart sementara berisi item yang dipilih
    const originalCart = [...cart];
    const bayar = [];
    const sisa = [];

    originalCart.forEach((item, i) => {
        if(splitSelection.includes(i)) bayar.push(item);
        else sisa.push(item);
    });
    
    cart = bayar;
    remainingCartItems = sisa; // Simpan sisa item untuk dikembalikan nanti
    
    tutupModalSplitBill();
    bayarSekarang(); // Proses bayar dengan cart yang sudah difilter
}

// --- FUNGSI KATEGORI ---
function getKategoriList() {
    // Mengambil semua kategori unik, memfilternya, dan mengurutkannya
    const kategoriUnik = [...new Set(gudang.map(p => p.kategori).filter(Boolean))].sort();
    return ['semua', ...kategoriUnik];
}

function renderKategoriFilter() {
    const filterEl = document.getElementById('kategori-filter');
    const currentVal = filterEl.value;
    const kategori = getKategoriList();
    filterEl.innerHTML = kategori.map(k => `<option value="${k}" ${k === currentVal ? 'selected' : ''}>${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
}

function loadMoreStok() {
    stokLimit += 20;
    renderStok();
}

function renderStok() {
    const list = document.getElementById('list-stok');
    if(gudang.length === 0) {
        list.innerHTML = `
            <div class="text-center py-20 text-gray-400">
                <svg class="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                <h3 class="mt-2 text-sm font-medium text-gray-500">Belum Ada Produk</h3>
                <p class="mt-1 text-sm text-gray-400">Klik tombol '+' untuk menambahkan produk pertama Anda.</p>
            </div>`;
        return;
    }

    const filterKategori = document.getElementById('kategori-filter').value;
    const produkToShow = (filterKategori === 'semua') 
        ? gudang 
        : gudang.filter(p => p.kategori === filterKategori);

    const renderedItems = produkToShow.slice(0, stokLimit).sort((a, b) => a.nama.localeCompare(b.nama)).map(p => `
        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center cursor-pointer hover:shadow-md transition-shadow" onclick="openModalTambahProduk('${p.sku}')">
            <img src="${p.gambar || 'https://via.placeholder.com/80x80.png?text=No+Image'}" class="w-16 h-16 object-cover rounded-lg mr-4 bg-slate-100">
            <div class="flex-1 cursor-pointer" onclick="openModalTambahProduk('${p.sku}')">
                <div class="font-bold text-gray-800 text-base">${escapeHtml(p.nama)}</div>
                <div class="flex items-center gap-2 mt-1">
                    <div class="text-xs text-gray-400 font-mono">${escapeHtml(p.sku)}</div>
                    <div class="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">${formatRupiah(p.harga)}</div>
                </div>
                ${p.kategori ? `<div class="mt-1 text-xs text-gray-500 inline-block">${escapeHtml(p.kategori)}</div>` : ''}
            </div>
            <div class="flex flex-col items-end gap-2 ml-4">
                <span class="px-3 py-1 rounded-full text-xs font-bold ${p.stok <= 0 ? 'bg-gray-200 text-gray-600' : (p.stok < 5 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}">
                    ${p.stok <= 0 ? 'Habis' : 'Stok: ' + p.stok}
                </span>
                <button onclick="cetakLabelRak('${p.sku}'); event.stopPropagation();" class="text-xs text-indigo-500 font-bold bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition mb-1">Label</button>
                <button onclick="hapusProduk(event, '${p.sku}')" class="text-xs text-red-400 font-bold bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 transition">Hapus</button>
            </div>
        </div>
    `).join('');

    // Tambahkan tombol Load More jika masih ada sisa produk
    if (produkToShow.length > stokLimit) {
        list.innerHTML = renderedItems + `<button onclick="loadMoreStok()" class="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-xl mt-2 hover:bg-slate-200">Muat Lebih Banyak (${produkToShow.length - stokLimit} lagi)</button>`;
    } else {
        list.innerHTML = renderedItems;
    }
}

function hapusProduk(event, sku) {
    event.stopPropagation(); // Mencegah modal edit terbuka
    if(confirm('Yakin hapus produk ini? Aksi ini tidak bisa dibatalkan.')) {
        gudang = gudang.filter(p => p.sku !== sku);
        
        // [FIX] Hapus juga dari keranjang agar tidak error
        cart = cart.filter(c => c.sku !== sku);
        tempCart = tempCart.filter(c => c.sku !== sku);
        
        localStorage.setItem('gudang_data', JSON.stringify(gudang));
        renderStok();
        showToast("Produk berhasil dihapus", "success");
    }
}

function cetakLabelRak(sku) {
    const p = gudang.find(x => x.sku === sku);
    if(!p) return;
    
    let html = `
    <html><head><title>Label ${p.nama}</title>
    <style>body{font-family:sans-serif;width:6cm;margin:0;padding:10px;border:1px solid #ccc;text-align:center}.nama{font-size:14px;font-weight:bold;margin-bottom:5px}.harga{font-size:24px;font-weight:bold;color:#000;margin:5px 0}.sku{font-size:10px;color:#555}svg{width:100%;height:50px}</style>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    </head><body onload="JsBarcode('#bc', '${p.sku}', {format:'CODE128', height:40, displayValue:false}); setTimeout(()=>window.print(), 500);">
        <div class="nama">${p.nama}</div>
        <div class="harga">${formatRupiah(p.harga)}</div>
        <svg id="bc"></svg>
        <div class="sku">${p.sku}</div>
    </body></html>`;
    
    const win = window.open('', '', 'width=300,height=200');
    win.document.write(html);
    win.document.close();
}

// --- STOCK LOGGING ---
function logStockChange(sku, nama, change, reason) {
    if(change === 0) return;
    stockLog.unshift({
        date: new Date().toISOString(),
        sku, nama, change, reason
    });
    // Keep log size manageable (e.g., last 500 entries)
    if(stockLog.length > 500) stockLog.pop();
    localStorage.setItem('stock_log', JSON.stringify(stockLog));
}
function bukaModalRiwayatStok() {
    const list = document.getElementById('list-riwayat-stok');
    const empty = document.getElementById('empty-riwayat-stok');
    
    if(stockLog.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        list.innerHTML = stockLog.map(log => `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 text-sm">
                <div class="flex justify-between font-bold text-slate-700">
                    <span>${escapeHtml(log.nama)}</span>
                    <span class="${log.change > 0 ? 'text-emerald-600' : 'text-red-500'}">${log.change > 0 ? '+' : ''}${log.change}</span>
                </div>
                <div class="flex justify-between text-xs text-slate-400 mt-1">
                    <span>${new Date(log.date).toLocaleString('id-ID')}</span>
                    <span>${log.reason}</span>
                </div>
            </div>
        `).join('');
    }
    document.getElementById('modal-riwayat-stok').classList.remove('hidden');
    document.getElementById('modal-riwayat-stok').classList.add('flex');
}

function tutupModalRiwayatStok() {
    document.getElementById('modal-riwayat-stok').classList.add('hidden');
    document.getElementById('modal-riwayat-stok').classList.remove('flex');
}

// --- MANAJEMEN PELANGGAN ---
function renderPelanggan() {
    const list = document.getElementById('list-pelanggan');
    const empty = document.getElementById('empty-pelanggan');
    
    if(pelanggan.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    
    empty.classList.add('hidden');
    list.innerHTML = pelanggan.map(p => `
        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center">
            <div>
                <div class="font-bold text-gray-800">${escapeHtml(p.nama)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(p.nohp)} <span class="ml-2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-bold text-[10px]">${p.poin || 0} Poin</span></div>
                <div class="text-[10px] text-gray-400 truncate max-w-[200px]">${escapeHtml(p.alamat || '-')}</div>
            </div>
            <button onclick="hapusPelanggan('${p.id}')" class="text-red-500 bg-red-50 p-2 rounded-lg hover:bg-red-100">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
        </div>
    `).join('');
}

function openModalTambahPelanggan() {
    document.getElementById('pel-nama').value = '';
    document.getElementById('pel-nohp').value = '';
    document.getElementById('pel-alamat').value = '';
    document.getElementById('modal-tambah-pelanggan').classList.remove('hidden');
    document.getElementById('modal-tambah-pelanggan').classList.add('flex');
}

function closeModalTambahPelanggan() {
    document.getElementById('modal-tambah-pelanggan').classList.add('hidden');
    document.getElementById('modal-tambah-pelanggan').classList.remove('flex');
}

function simpanPelanggan() {
    const nama = document.getElementById('pel-nama').value;
    const nohp = document.getElementById('pel-nohp').value;
    const alamat = document.getElementById('pel-alamat').value;
    
    if(!nama) return showToast("Nama pelanggan wajib diisi", "error");
    
    pelanggan.push({ id: 'PEL-' + Date.now(), nama, nohp, alamat, poin: 0 });
    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
    showToast("Pelanggan berhasil ditambahkan", "success");
    closeModalTambahPelanggan();
    renderPelanggan();
}

function hapusPelanggan(id) {
    if(confirm("Hapus data pelanggan ini?")) {
        pelanggan = pelanggan.filter(p => p.id !== id);
        localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
        renderPelanggan();
        showToast("Pelanggan dihapus", "success");
    }
}

// --- LOGIKA PEMBAYARAN & PAJAK ---
function simpanSettingPajak(val) {
    settingPajak = parseFloat(val) || 0;
    localStorage.setItem('setting_pajak', settingPajak);
    showToast("Pengaturan pajak disimpan", "success");
}

function simpanProfilToko() {
    profilToko.nama = document.getElementById('set-nama-toko').value || 'KASIR PINTAR PRO';
    profilToko.alamat = document.getElementById('set-alamat-toko').value || '';
    profilToko.nohp = document.getElementById('set-nohp-toko').value || '';
    profilToko.footer = document.getElementById('set-footer-struk').value || '';
    profilToko.infoBayar = document.getElementById('set-info-bayar').value || '';
    
    localStorage.setItem('profil_toko', JSON.stringify(profilToko));
    document.getElementById('header-nama-toko').innerHTML = profilToko.nama;
    showToast("Profil toko berhasil disimpan", "success");
}

function simpanHappyHour() {
    profilToko.happyHour = {
        start: document.getElementById('hh-start').value,
        end: document.getElementById('hh-end').value,
        percent: parseFloat(document.getElementById('hh-percent').value) || 0
    };
    localStorage.setItem('profil_toko', JSON.stringify(profilToko));
    showToast("Setting Happy Hour disimpan", "success");
}

function simpanLevelMember() {
    settings.memberLevels = {
        silver: {
            pts: parseInt(document.getElementById('level-silver-pts').value) || 0,
            disc: parseFloat(document.getElementById('level-silver-disc').value) || 0,
        },
        gold: {
            pts: parseInt(document.getElementById('level-gold-pts').value) || 0,
            disc: parseFloat(document.getElementById('level-gold-disc').value) || 0,
        }
    };
    localStorage.setItem('app_settings', JSON.stringify(settings));
    showToast("Setting Level Member disimpan", "success");
}

function tambahVoucher() {
    const code = document.getElementById('voucher-code').value.toUpperCase();
    const value = parseInt(document.getElementById('voucher-value').value);

    if(!code || !value) return showToast("Kode dan Nominal wajib diisi!", "error");
    if(vouchers.find(v => v.code === code)) return showToast("Kode voucher sudah ada!", "error");

    vouchers.push({ code, value, used: false });
    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
    renderVouchers();
    document.getElementById('voucher-code').value = '';
    document.getElementById('voucher-value').value = '';
}

function hapusVoucher(code) {
    vouchers = vouchers.filter(v => v.code !== code);
    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
    renderVouchers();
}

function renderVouchers() {
    const list = document.getElementById('list-vouchers');
    list.innerHTML = vouchers.map(v => `<div class="flex justify-between items-center bg-white p-2 rounded-lg border text-sm"><span class="font-mono font-bold text-sky-700">${v.code}</span><span>Rp ${v.value.toLocaleString()}</span><button onclick="hapusVoucher('${v.code}')" class="text-red-500">✕</button></div>`).join('');
}

function bayarSekarang() {
    if(cart.length === 0) return showToast("Keranjang Kosong!", "error");
    
    setMetodeBayar('tunai'); // Default
    document.getElementById('input-diskon-global').value = '';
    document.getElementById('input-voucher').value = '';
    hitungTotalBayar();
    
    const inputUang = document.getElementById('input-uang');
    inputUang.value = '';
    document.getElementById('txt-kembalian').innerText = 'Rp 0';
    document.getElementById('text-info-bayar').innerText = profilToko.infoBayar || "Belum ada info pembayaran.";
    
    document.getElementById('modal-bayar').classList.remove('hidden');
    document.getElementById('modal-bayar').classList.add('flex');
    setTimeout(() => {
        inputUang.focus();
    }, 100);
}

function setMetodeBayar(metode) {
    metodePembayaran = metode;
    const btnTunai = document.getElementById('btn-bayar-tunai');
    const btnNon = document.getElementById('btn-bayar-nontunai');
    const btnHutang = document.getElementById('btn-bayar-hutang');
    const boxInfo = document.getElementById('box-info-bayar');
    const inputUang = document.getElementById('input-uang');

    // Reset styles
    const inactiveClass = "flex-1 py-2 text-sm font-bold rounded-lg text-gray-500 hover:text-gray-700 transition-all";
    btnTunai.className = inactiveClass;
    btnNon.className = inactiveClass;
    btnHutang.className = inactiveClass;

    if(metode === 'tunai') {
        btnTunai.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-teal-600 transition-all ring-2 ring-teal-500";
        boxInfo.classList.add('hidden');
        inputUang.value = '';
        inputUang.disabled = false;
        inputUang.focus();
    } else if (metode === 'nontunai') {
        btnNon.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-blue-600 transition-all ring-2 ring-blue-500";
        boxInfo.classList.remove('hidden');
        // Auto fill total for non-tunai
        inputUang.value = hitungTotalBayar();
        inputUang.disabled = true;
    } else if (metode === 'hutang') {
        btnHutang.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-amber-600 transition-all ring-2 ring-amber-500";
        boxInfo.classList.add('hidden');
        inputUang.value = 0;
        inputUang.disabled = true;
        
        // Cek apakah pelanggan dipilih
        const pelId = document.getElementById('pilih-pelanggan').value;
        if(!pelId) {
            showToast("Wajib pilih pelanggan untuk Hutang!", "error");
        }
    }
    hitungKembalian();
}

function checkHappyHour() {
    if(!profilToko.happyHour || !profilToko.happyHour.start || !profilToko.happyHour.end || profilToko.happyHour.percent <= 0) return false;
    
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    
    const [startH, startM] = profilToko.happyHour.start.split(':').map(Number);
    const start = startH * 60 + startM;
    
    const [endH, endM] = profilToko.happyHour.end.split(':').map(Number);
    const end = endH * 60 + endM;
    
    return current >= start && current <= end;
}

function hitungTotalBayar() {
    // 1. Hitung Subtotal (Harga Item - Diskon Item) * Qty
    const subtotal = cart.reduce((sum, item) => sum + ((item.harga - (item.diskon || 0)) * item.qty), 0);
    
    // 2. Ambil Diskon Global
    // [BARU] Support Diskon Persen (misal: "10%")
    const diskonInput = document.getElementById('input-diskon-global').value;
    let diskonGlobal = 0;
    if(diskonInput.includes('%')) {
        const persentase = parseFloat(diskonInput.replace('%', '')) || 0;
        diskonGlobal = subtotal * (persentase / 100);
    } else {
        diskonGlobal = parseInt(diskonInput) || 0;
    }
    
    // [BARU] Cek Voucher
    const voucherCode = document.getElementById('input-voucher').value.toUpperCase();
    const voucher = vouchers.find(v => v.code === voucherCode && !v.used);
    if(voucherCode && voucher) {
        diskonGlobal += voucher.value;
        showToast(`Voucher ${voucherCode} diterapkan!`, 'success');
    } else if (voucherCode) {
        showToast(`Voucher tidak valid atau sudah digunakan.`, 'error');
    }

    // [BARU] Cek Happy Hour Auto Discount
    if(checkHappyHour()) {
        const hhDisc = subtotal * (profilToko.happyHour.percent / 100);
        diskonGlobal += hhDisc;
    }

    // [BARU] Cek Member Level Discount
    const pelId = document.getElementById('pilih-pelanggan').value;
    const pelData = pelanggan.find(p => p.id === pelId);
    if(pelData) {
        const { silver, gold } = settings.memberLevels;
        if(pelData.poin >= gold.pts && gold.disc > 0) {
            diskonGlobal += subtotal * (gold.disc / 100);
        } else if (pelData.poin >= silver.pts && silver.disc > 0) {
            diskonGlobal += subtotal * (silver.disc / 100);
        }
    }

    // 3. Hitung Pajak (dari Subtotal - Diskon Global)
    const taxableAmount = Math.max(0, subtotal - diskonGlobal);
    const pajakNominal = Math.round(taxableAmount * (settingPajak / 100));
    
    // 4. Total Akhir
    const totalAkhir = taxableAmount + pajakNominal;

    // Render ke UI
    document.getElementById('bayar-subtotal').innerText = `Rp ${subtotal.toLocaleString()}`;
    document.getElementById('bayar-pajak').innerText = `Rp ${pajakNominal.toLocaleString()} (${settingPajak}%)`;
    document.getElementById('bayar-total').innerText = `Rp ${totalAkhir.toLocaleString()}`;
    
    return totalAkhir;
}

function tutupModalBayar() {
    document.getElementById('modal-bayar').classList.add('hidden');
    document.getElementById('modal-bayar').classList.remove('flex');
}

function hitungKembalian() {
    const total = hitungTotalBayar();
    const uang = parseInt(document.getElementById('input-uang').value) || 0;
    const kembali = uang - total;
    document.getElementById('txt-kembalian').innerText = `Rp ${kembali.toLocaleString()}`;
    document.getElementById('txt-kembalian').className = kembali >= 0 ? "text-2xl font-bold text-emerald-600" : "text-2xl font-bold text-red-600";
}

function prosesPembayaranFinal() {
    if(isProcessingPay) return; // [BARU] Cegah double submit
    isProcessingPay = true;

    const total = hitungTotalBayar();
    const uang = parseInt(document.getElementById('input-uang').value) || 0;
    
    if(metodePembayaran !== 'hutang' && uang < total) {
        isProcessingPay = false;
        return showToast("Uang kurang!", "error");
    }
    // [FIX] Kembalian untuk hutang harus 0 (karena uang masuk dianggap 0 atau DP, tapi di sini hutang full)
    const kembali = metodePembayaran === 'hutang' ? 0 : (uang - total);

    // Validasi Hutang
    const pelId = document.getElementById('pilih-pelanggan').value;
    if(metodePembayaran === 'hutang' && !pelId) {
        isProcessingPay = false;
        return showToast("Pilih pelanggan dulu!", "error");
    }

    let totalBayar = 0;
    const itemsStruk = [];

    cart.forEach(item => {
        const p = gudang.find(x => x.sku === item.sku);
        if(p) p.stok -= item.qty;
        logStockChange(item.sku, item.nama, -item.qty, 'Penjualan');
        // Simpan harga final per item di struk
        itemsStruk.push({...item});
    });

    const subtotal = cart.reduce((sum, item) => sum + ((item.harga - (item.diskon || 0)) * item.qty), 0);
    
    // Hitung ulang diskon final untuk disimpan
    const diskonInput = document.getElementById('input-diskon-global').value;
    let diskonGlobal = 0;
    if(diskonInput.includes('%')) {
        diskonGlobal = subtotal * (parseFloat(diskonInput.replace('%', '')) / 100);
    } else {
        diskonGlobal = parseInt(diskonInput) || 0;
    }
    
    // [BARU] Apply Happy Hour to Final Transaction Data
    if(checkHappyHour()) {
        const hhDisc = subtotal * (profilToko.happyHour.percent / 100);
        diskonGlobal += hhDisc;
    }

    // Ambil data pelanggan
    const pelData = pelanggan.find(p => p.id === pelId);

    // [BARU] Apply Member Level Discount to Final Transaction Data
    if(pelData) {
        const { silver, gold } = settings.memberLevels;
        if(pelData.poin >= gold.pts && gold.disc > 0) {
            diskonGlobal += subtotal * (gold.disc / 100);
        } else if (pelData.poin >= silver.pts && silver.disc > 0) {
            diskonGlobal += subtotal * (silver.disc / 100);
        }
    }

    // [BARU] Apply Voucher to Final Transaction Data
    const voucherCode = document.getElementById('input-voucher').value.toUpperCase();
    const voucher = vouchers.find(v => v.code === voucherCode && !v.used);
    if(voucher) {
        diskonGlobal += voucher.value;
        // Mark as used (for simplicity, we assume all vouchers are single-use)
        voucher.used = true;
    }

    const pajakNominal = Math.round(Math.max(0, subtotal - diskonGlobal) * (settingPajak / 100));
    
    // Hitung Poin (1 Poin tiap Rp 10.000)
    let poinDidapat = 0;
    if (pelData) {
        poinDidapat = Math.floor(total / 10000);
        pelData.poin = (pelData.poin || 0) + poinDidapat;
        
        // [BARU] Tambah Hutang jika metode hutang
        if(metodePembayaran === 'hutang') {
            pelData.hutang = (pelData.hutang || 0) + total;
        }
    }

    const transaksi = {
        id: 'TRX-' + Date.now(),
        tanggal: new Date().toISOString(),
        items: itemsStruk,
        subtotal: subtotal,
        diskonGlobal: diskonGlobal,
        pajak: pajakNominal,
        total: total,
        bayar: uang,
        kembali: kembali,
        pelanggan: pelData ? { nama: pelData.nama, id: pelData.id, nohp: pelData.nohp, poinEarned: poinDidapat } : null,
        metode: metodePembayaran
    };
    riwayat.push(transaksi);
    
    localStorage.setItem('gudang_data', JSON.stringify(gudang));
    localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
    // Simpan update poin pelanggan
    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
    
    showToast("Pembayaran Berhasil!", "success");
    tutupModalBayar();
    
    // [BARU] Jika dari meja, kosongkan meja
    if(activeTableId) {
        // If it was a split bill, remove paid items from the table
        if (splitSelection.length > 0) {
            const meja = mejaData.find(m => m.id === activeTableId);
            const paidSkus = cart.map(item => item.sku);
            meja.pesanan = meja.pesanan.filter(item => !paidSkus.includes(item.sku));
            if(meja.pesanan.length === 0) meja.status = 'kosong';
            showToast("Pembayaran Split Berhasil. Sisa pesanan tersimpan di meja.", "info");
        } else { // If it was a full payment, clear the table
            const mejaIndex = mejaData.findIndex(m => m.id === activeTableId);
            mejaData[mejaIndex].status = 'kosong';
            mejaData[mejaIndex].pesanan = [];
        }
        localStorage.setItem('meja_data', JSON.stringify(mejaData));
        tutupMejaAktif();
    } else {
        // Retail Logic: Restore remaining items if split bill
        if (remainingCartItems.length > 0) {
            cart = [...remainingCartItems];
            remainingCartItems = [];
            showToast("Pembayaran sebagian berhasil. Sisa item ada di keranjang.", "info");
            renderCart();
            return; // Don't clear cart below
        }
    }
    
    cart = [];
    splitSelection = []; // Reset split
    renderCart();
    renderKategoriFilter();
    renderStok();
    tampilkanStruk(transaksi);
    isProcessingPay = false; // [BARU] Reset flag
}

// STRUK & LAPORAN
function kirimStrukWA(trx) {
    let text = `*${profilToko.nama}*\n`;
    text += `${profilToko.alamat}\n\n`;
    text += `Tgl: ${new Date(trx.tanggal).toLocaleString('id-ID')}\n`;
    text += `ID: ${trx.id}\n`;
    text += `--------------------------------\n`;
    
    trx.items.forEach(item => {
        const hargaFinal = item.harga - (item.diskon || 0);
        text += `${item.nama} x${item.qty} = ${parseInt(hargaFinal * item.qty).toLocaleString()}\n`;
    });
    
    text += `--------------------------------\n`;
    text += `Subtotal: Rp ${trx.subtotal.toLocaleString()}\n`;
    if(trx.diskonGlobal > 0) text += `Diskon: -Rp ${trx.diskonGlobal.toLocaleString()}\n`;
    if(trx.pajak > 0) text += `Pajak: Rp ${trx.pajak.toLocaleString()}\n`;
    text += `Metode: ${trx.metode === 'tunai' ? 'TUNAI' : 'NON-TUNAI'}\n`;
    text += `*TOTAL: Rp ${trx.total.toLocaleString()}*\n`;
    text += `Tunai: Rp ${trx.bayar.toLocaleString()}\n`;
    text += `Kembali: Rp ${trx.kembali.toLocaleString()}\n\n`;
    text += `${profilToko.footer}`;

    const encodedText = encodeURIComponent(text);
    const nohp = trx.pelanggan && trx.pelanggan.nohp ? trx.pelanggan.nohp.replace(/^0/, '62').replace(/\D/g,'') : '';
    
    window.open(`https://wa.me/${nohp}?text=${encodedText}`, '_blank');
}

// [BARU] Fitur Batalkan Transaksi
function batalkanTransaksi(id) {
    if(!confirm("Yakin ingin membatalkan transaksi ini? Stok akan dikembalikan dan poin pelanggan ditarik.")) return;

    const trxIndex = riwayat.findIndex(t => t.id === id);
    if (trxIndex === -1) return showToast("Transaksi tidak ditemukan", "error");

    const trx = riwayat[trxIndex];

    // 1. Kembalikan Stok
    trx.items.forEach(item => {
        const produk = gudang.find(p => p.sku === item.sku);
        if (produk) {
            produk.stok += item.qty;
            logStockChange(item.sku, item.nama, item.qty, 'Batal Transaksi');
        }
    });

    // 2. Tarik Poin Pelanggan (Jika ada)
    if (trx.pelanggan && trx.pelanggan.id) {
        const pelIndex = pelanggan.findIndex(p => p.id === trx.pelanggan.id);
        if (pelIndex > -1) {
            pelanggan[pelIndex].poin = Math.max(0, (pelanggan[pelIndex].poin || 0) - (trx.pelanggan.poinEarned || 0));
        }
    }

    // 3. Hapus Transaksi & Simpan
    riwayat.splice(trxIndex, 1);
    localStorage.setItem('gudang_data', JSON.stringify(gudang));
    localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
    localStorage.setItem('stock_log', JSON.stringify(stockLog));

    showToast("Transaksi berhasil dibatalkan", "success");
    tutupStruk();
    renderLaporan(); 
    renderDashboard();
    renderStok();
}

// [BARU] Fungsi Cetak Struk Thermal
function cetakStruk(id) {
    const trx = riwayat.find(t => t.id === id);
    if(!trx) return;
    
    let html = `
    <html><head><title>Print Struk</title><style>
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 58mm; margin: 0; padding: 5px; color: #000; }
        .center { text-align: center; }
        .flex { display: flex; justify-content: space-between; }
        hr { border: 0; border-bottom: 1px dashed #000; margin: 5px 0; }
        .bold { font-weight: bold; }
        .small { font-size: 10px; }
    </style></head><body>
        <div class="center bold">${profilToko.nama}</div>
        <div class="center small">${profilToko.alamat}</div>
        <hr>
        <div class="small">${new Date(trx.tanggal).toLocaleString('id-ID')}</div>
        <div class="small">ID: ${trx.id}</div>
        <hr>
    `;
    
    trx.items.forEach(item => {
        html += `<div>${item.nama}</div>
        <div class="flex">
            <span>${item.qty} x ${parseInt(item.harga - (item.diskon||0)).toLocaleString()}</span>
            <span>${parseInt((item.harga - (item.diskon||0)) * item.qty).toLocaleString()}</span>
        </div>`;
    });
    
    html += `<hr>
        <div class="flex bold"><span>TOTAL</span> <span>${parseInt(trx.total).toLocaleString()}</span></div>
        <div class="flex"><span>Tunai</span> <span>${parseInt(trx.bayar).toLocaleString()}</span></div>
        <div class="flex"><span>Kembali</span> <span>${parseInt(trx.kembali).toLocaleString()}</span></div>
        <hr>
        <div class="center small">${profilToko.footer}</div>
    </body></html>`;
    
    const win = window.open('', '', 'width=300,height=500');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
}

function tampilkanStruk(trx) {
    const area = document.getElementById('receipt-area');
    const tgl = new Date(trx.tanggal).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    
    let html = `
        <h3 class="font-bold text-xl mb-1 text-gray-800 uppercase">${profilToko.nama}</h3>
        <p class="text-xs text-gray-500 mb-1">${profilToko.alamat}</p>
        <p class="text-xs text-gray-500 mb-4">${profilToko.nohp}</p>
        <p class="text-xs text-gray-500 mb-2 border-b border-dashed pb-2">${tgl}<br>ID: ${trx.id}<br>${trx.pelanggan ? 'Member: ' + trx.pelanggan.nama : 'Pelanggan: Umum'}</p>
        <div class="text-left border-t border-b border-dashed py-2 my-2 space-y-1 text-sm">
    `;
    
    trx.items.forEach(item => {
        const hargaFinal = item.harga - (item.diskon || 0);
        html += `
            <div class="flex justify-between">
                <span>${item.nama} (${item.qty}x)</span>
                <span>${(hargaFinal * item.qty).toLocaleString()}</span>
            </div>
            ${item.diskon > 0 ? `<div class="text-[10px] text-gray-400 text-right">Disc: -${item.diskon.toLocaleString()}/item</div>` : ''}
        `;
    });

    html += `
        </div>
        <div class="text-right space-y-1 mt-2 text-gray-800">
            <div class="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>Rp ${(trx.subtotal || trx.total).toLocaleString()}</span>
            </div>
            ${trx.diskonGlobal > 0 ? `
            <div class="flex justify-between text-sm text-red-500">
                <span>Diskon</span>
                <span>-Rp ${trx.diskonGlobal.toLocaleString()}</span>
            </div>` : ''}
            ${trx.pajak > 0 ? `
            <div class="flex justify-between text-sm text-gray-500">
                <span>Pajak</span>
                <span>Rp ${trx.pajak.toLocaleString()}</span>
            </div>` : ''}
            <div class="flex justify-between text-sm text-gray-500">
                <span>Metode</span>
                <span class="uppercase font-bold">${trx.metode === 'tunai' ? 'TUNAI' : 'NON-TUNAI'}</span>
            </div>
            <div class="flex justify-between font-bold text-lg">
                <span>TOTAL</span>
                <span>Rp ${trx.total.toLocaleString()}</span>
            </div>
            <div class="flex justify-between text-sm text-gray-600">
                <span>Tunai</span>
                <span>Rp ${(trx.bayar || trx.total).toLocaleString()}</span>
            </div>
            <div class="flex justify-between text-sm text-gray-600">
                <span>Kembali</span>
                <span>Rp ${(trx.kembali || 0).toLocaleString()}</span>
            </div>
        </div>
        <p class="text-[10px] text-gray-400 mt-4">${profilToko.footer}</p>
        <div class="mt-4 pt-2 border-t border-dashed">
            <button onclick="cetakStruk('${trx.id}')" class="w-full py-2 text-xs font-bold text-slate-600 bg-slate-200 rounded-lg hover:bg-slate-300 mb-2 border border-slate-300">🖨 Cetak Struk (Thermal)</button>
            <button onclick="batalkanTransaksi('${trx.id}')" class="w-full py-2 text-xs font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100 border border-red-100">⚠ Batalkan Transaksi</button>
        </div>
    `;
    
    area.innerHTML = html;
    
    // Setup tombol WA
    const btnWa = document.getElementById('btn-wa-struk');
    btnWa.onclick = () => kirimStrukWA(trx);

    document.getElementById('modal-struk').classList.remove('hidden');
    document.getElementById('modal-struk').classList.add('flex');
}

function tutupStruk() {
    document.getElementById('modal-struk').classList.add('hidden');
    document.getElementById('modal-struk').classList.remove('flex');
}

function renderLaporan() {
    const tglMulaiEl = document.getElementById('tgl-mulai');
    const tglSelesaiEl = document.getElementById('tgl-selesai');

    // Set default ke hari ini jika kosong
    if (!tglMulaiEl.value) tglMulaiEl.valueAsDate = new Date();
    if (!tglSelesaiEl.value) tglSelesaiEl.valueAsDate = new Date();

    const startDate = new Date(tglMulaiEl.value);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tglSelesaiEl.value);
    endDate.setHours(23, 59, 59, 999);

    const filteredTrx = riwayat.filter(t => {
        const trxDate = new Date(t.tanggal);
        return trxDate >= startDate && trxDate <= endDate;
    });

    let totalOmzet = 0;
    let totalModal = 0; // HPP
    let totalProdukTerjual = 0;
    const salesByDay = {};

    filteredTrx.forEach(t => {
        totalOmzet += t.total;
        t.items.forEach(item => {
            totalProdukTerjual += item.qty;
            // Hitung Modal (HPP)
            // [FIX] Prioritaskan modal yang tersimpan di riwayat transaksi (snapshot)
            // Jika tidak ada (data lama), baru ambil dari gudang saat ini
            let modalPerItem = 0;
            if (item.hasOwnProperty('modal')) {
                modalPerItem = parseInt(item.modal) || 0;
            } else {
                const produkGudang = gudang.find(g => g.sku === item.sku);
                modalPerItem = produkGudang ? (parseInt(produkGudang.modal) || 0) : 0;
            }
            totalModal += (modalPerItem * item.qty);
        });

        const day = new Date(t.tanggal).toISOString().split('T')[0];
        salesByDay[day] = (salesByDay[day] || 0) + t.total;
    });

    const totalTransaksi = filteredTrx.length;
    
    // Hitung Pengeluaran di rentang tanggal
    const filteredPengeluaran = pengeluaran.filter(p => {
        const pDate = new Date(p.tanggal);
        return pDate >= startDate && pDate <= endDate;
    }).reduce((sum, p) => sum + p.nominal, 0);

    // Hitung Laba Bersih
    const labaBersih = totalOmzet - totalModal - filteredPengeluaran;

    document.getElementById('lpr-total-omzet').innerText = `Rp ${totalOmzet.toLocaleString()}`;
    document.getElementById('lpr-total-modal').innerText = `Rp ${totalModal.toLocaleString()}`;
    document.getElementById('lpr-total-pengeluaran').innerText = `Rp ${filteredPengeluaran.toLocaleString()}`;
    document.getElementById('lpr-laba-bersih').innerText = `Rp ${labaBersih.toLocaleString()}`;
    // document.getElementById('lpr-laba-bersih').className = labaBersih >= 0 ? "text-2xl font-bold text-white" : "text-2xl font-bold text-red-200";

    const list = document.getElementById('list-riwayat');
    if (filteredTrx.length === 0) {
        list.innerHTML = `<p class='text-center text-gray-400 py-8'>Belum ada riwayat transaksi.</p>`;
    } else {
        list.innerHTML = filteredTrx.slice().reverse().map(t => `
        <div onclick='tampilkanStruk(${JSON.stringify(t)})' class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border-b border-slate-100 cursor-pointer hover:bg-slate-100">
            <div>
                <div class="font-bold text-sm text-gray-800">${new Date(t.tanggal).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                <div class="text-xs text-gray-400">${new Date(t.tanggal).toLocaleDateString('id-ID')}</div>
            </div>
            <div class="font-bold text-teal-600">Rp ${t.total.toLocaleString()}</div>
        </div>
    `).join('');
    }

    renderSalesChart(salesByDay, startDate, endDate);
}

function setLaporanHariIni() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tgl-mulai').value = today;
    document.getElementById('tgl-selesai').value = today;
    renderLaporan();
    showToast("Filter hari ini diterapkan", "success");
}

// [BARU] MENU VISUAL UNTUK KASIR
function renderMenuKategori() {
    const tabsContainer = document.getElementById('menu-kategori-tabs');
    const kategori = getKategoriList();
    tabsContainer.innerHTML = kategori.map(k => `
        <button onclick="renderMenuGrid('${k}')" class="menu-kategori-btn flex-shrink-0 px-4 py-2 text-sm font-bold rounded-lg transition" data-kategori="${k}">
            ${k.charAt(0).toUpperCase() + k.slice(1)}
        </button>
    `).join('');
}

function renderMenuGrid(kategoriFilter = 'semua') {
    const gridContainer = document.getElementById('menu-grid');
    const produkToShow = (kategoriFilter === 'semua') 
        ? gudang 
        : gudang.filter(p => p.kategori === kategoriFilter);

    if (produkToShow.length === 0) {
        gridContainer.innerHTML = `<p class="text-center text-slate-400 col-span-full py-10">Tidak ada produk di kategori ini.</p>`;
    } else {
        gridContainer.innerHTML = produkToShow.sort((a,b) => a.nama.localeCompare(b.nama)).map(p => `
            <div onclick="tambahKeCart('${p.sku}')" class="bg-slate-50 rounded-xl p-2 flex flex-col items-center text-center cursor-pointer hover:bg-teal-50 hover:ring-2 hover:ring-teal-500 transition-all active:scale-95">
                <img src="${p.gambar || 'https://via.placeholder.com/150x150.png?text=No+Image'}" class="w-full h-24 object-cover rounded-lg mb-2 bg-white">
                <p class="text-xs font-bold text-slate-700 flex-grow">${escapeHtml(p.nama)}</p>
                <p class="text-sm font-bold text-teal-600 mt-1">${formatRupiah(p.harga)}</p>
            </div>
        `).join('');
    }

    // Update active button style
    document.querySelectorAll('.menu-kategori-btn').forEach(btn => {
        if (btn.dataset.kategori === kategoriFilter) {
            btn.classList.add('bg-teal-600', 'text-white', 'shadow-md');
            btn.classList.remove('bg-slate-100', 'text-slate-600');
        } else {
            btn.classList.remove('bg-teal-600', 'text-white', 'shadow-md');
            btn.classList.add('bg-slate-100', 'text-slate-600');
        }
    });
}

// [BARU] LOGIKA ABSENSI
function startKameraAbsensi() {
    const video = document.getElementById('video-absensi');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
            .then(function(stream) {
                video.srcObject = stream;
            })
            .catch(function(err) {
                showToast("Gagal akses kamera depan!", "error");
            });
    }
}

function ambilAbsensi() {
    const video = document.getElementById('video-absensi');
    const canvas = document.getElementById('canvas-absensi');
    const context = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const foto = canvas.toDataURL('image/jpeg');
    const waktu = new Date().toISOString();
    
    absensiLog.unshift({ waktu, foto, user: currentUser.nama });
    localStorage.setItem('absensi_log', JSON.stringify(absensiLog));
    
    showToast("Absensi Berhasil!", "success");
    renderRiwayatAbsensi();
}

function renderRiwayatAbsensi() {
    const list = document.getElementById('riwayat-absensi');
    list.innerHTML = absensiLog.slice(0, 5).map(log => `
        <div class="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-100">
            <img src="${log.foto}" class="w-12 h-12 rounded-full object-cover border-2 border-teal-500">
            <div>
                <div class="font-bold text-sm text-slate-800">${log.user}</div>
                <div class="text-xs text-slate-500">${new Date(log.waktu).toLocaleString('id-ID')}</div>
            </div>
        </div>
    `).join('');
}

// [BARU] LOGIKA BARCODE GENERATOR
function generateBarcode() {
    const code = document.getElementById('bc-code').value || '12345678';
    const label = document.getElementById('bc-label').value;
    
    try {
        JsBarcode("#barcode-preview", code, {
            format: "CODE128",
            lineColor: "#000",
            width: 2,
            height: 80,
            displayValue: true,
            text: label || undefined,
            fontSize: 14,
            margin: 10
        });
    } catch(e) {
        // Ignore invalid characters input temporarily
    }
}

function renderListProdukBarcode() {
    const list = document.getElementById('list-produk-barcode');
    if(gudang.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm">Belum ada produk.</p>';
        return;
    }
    list.innerHTML = gudang.map(p => `
        <div onclick="setBarcodeFromProduct('${p.sku}', '${p.nama}')" class="flex justify-between items-center p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-indigo-50 border border-slate-100">
            <span class="font-bold text-sm text-slate-700">${escapeHtml(p.nama)}</span>
            <span class="text-xs font-mono text-slate-500 bg-white px-2 py-1 rounded border">${p.sku}</span>
        </div>
    `).join('');
}

function setBarcodeFromProduct(sku, nama) {
    document.getElementById('bc-code').value = sku;
    document.getElementById('bc-label').value = nama;
    generateBarcode();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function downloadBarcode() {
    const svg = document.getElementById('barcode-preview');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const data = (new XMLSerializer()).serializeToString(svg);
    const DOMURL = window.URL || window.webkitURL || window;
    
    const img = new Image();
    const svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
    const url = DOMURL.createObjectURL(svgBlob);
    
    img.onload = function () {
        canvas.width = img.width + 20;
        canvas.height = img.height + 20;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 10, 10);
        DOMURL.revokeObjectURL(url);
        
        const imgURI = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imgURI;
        a.download = `barcode-${document.getElementById('bc-code').value}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    img.src = url;
}

function printBarcode() {
    const svg = document.getElementById('barcode-preview');
    const win = window.open('', '', 'height=500,width=500');
    win.document.write('<html><head><title>Print Barcode</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;">');
    win.document.write(svg.outerHTML);
    win.document.write('</body></html>');
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
}

// [BARU] MANAJEMEN PENGELUARAN
function tambahPengeluaran() {
    const nama = document.getElementById('out-nama').value;
    const nominal = parseInt(document.getElementById('out-nominal').value);
    const kategori = document.getElementById('out-kategori').value;

    if(!nama || !nominal) return showToast("Nama dan Nominal wajib diisi", "error");

    pengeluaran.unshift({
        id: Date.now(),
        tanggal: new Date().toISOString(),
        nama, nominal, kategori
    });
    localStorage.setItem('pengeluaran_data', JSON.stringify(pengeluaran));
    
    document.getElementById('out-nama').value = '';
    document.getElementById('out-nominal').value = '';
    renderPengeluaran();
    showToast("Pengeluaran dicatat", "success");
}

function hapusPengeluaran(id) {
    if(!confirm("Hapus data pengeluaran ini?")) return;
    pengeluaran = pengeluaran.filter(p => p.id !== id);
    localStorage.setItem('pengeluaran_data', JSON.stringify(pengeluaran));
    renderPengeluaran();
}

function renderPengeluaran() {
    const list = document.getElementById('list-pengeluaran');
    const empty = document.getElementById('empty-pengeluaran');

    if(pengeluaran.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    list.innerHTML = pengeluaran.map(p => `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div>
                <div class="font-bold text-slate-800">${escapeHtml(p.nama)} <span class="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-500 ml-1">${escapeHtml(p.kategori)}</span></div>
                <div class="text-xs text-slate-400">${new Date(p.tanggal).toLocaleDateString('id-ID')}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold text-rose-600">-Rp ${p.nominal.toLocaleString()}</span>
                <button onclick="hapusPengeluaran(${p.id})" class="text-slate-400 hover:text-red-500">✕</button>
            </div>
        </div>
    `).join('');
}

// [BARU] MODAL SCANNER
function bukaModalScanner() {
    document.getElementById('modal-scanner').classList.remove('hidden');
    document.getElementById('modal-scanner').classList.add('flex');
    setTimeout(startKamera, 100);
}

function tutupModalScanner() {
    const modal = document.getElementById('modal-scanner');
    if (modal.classList.contains('hidden')) return;
    if (scanner && scanner.isScanning) {
        scanner.stop().catch(err => console.error("Gagal stop kamera saat tutup modal.", err));
    }
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// [BARU] Fitur Setor Laporan via WA (Pantau Jarak Jauh)
function shareLaporanWA() {
    const today = new Date().toDateString();
    const trxHariIni = riwayat.filter(t => new Date(t.tanggal).toDateString() === today);
    
    if(trxHariIni.length === 0) return showToast("Belum ada transaksi hari ini.", "info");

    const totalOmzet = trxHariIni.reduce((sum, t) => sum + t.total, 0);
    const totalTunai = trxHariIni.filter(t => t.metode === 'tunai').reduce((sum, t) => sum + t.bayar, 0); // Estimasi uang laci
    const totalNonTunai = trxHariIni.filter(t => t.metode !== 'tunai').reduce((sum, t) => sum + t.total, 0);
    
    // Hitung produk terlaris hari ini
    const productSales = {};
    trxHariIni.forEach(t => t.items.forEach(i => productSales[i.nama] = (productSales[i.nama] || 0) + i.qty));
    const topProducts = Object.entries(productSales).sort((a,b) => b[1] - a[1]).slice(0, 5).map(x => `- ${x[0]}: ${x[1]}`).join('\n');

    let text = `*LAPORAN HARIAN TOKO*\n`;
    text += `📅 ${new Date().toLocaleDateString('id-ID', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}\n`;
    text += `👤 Pelapor: ${currentUser.nama}\n\n`;
    
    text += `*RINGKASAN OMZET*\n`;
    text += `💰 Total Omzet: Rp ${totalOmzet.toLocaleString()}\n`;
    text += `📝 Jumlah Transaksi: ${trxHariIni.length}\n\n`;
    
    text += `*RINCIAN PEMBAYARAN*\n`;
    text += `💵 Tunai (Di Laci): Rp ${totalTunai.toLocaleString()}\n`;
    text += `💳 Non-Tunai: Rp ${totalNonTunai.toLocaleString()}\n\n`;

    text += `*PRODUK TERLARIS*\n${topProducts}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function renderSalesChart(salesData, startDate, endDate) {
    const container = document.getElementById('sales-chart-container');
    container.innerHTML = ''; // Clear previous chart

    const allDays = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        allDays.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    const labels = allDays.map(d => d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));
    const data = allDays.map(d => salesData[d.toISOString().split('T')[0]] || 0);

    const maxData = Math.max(...data);
    if (maxData === 0) {
        container.innerHTML = `<p class="text-center text-gray-400 h-full flex items-center justify-center">Tidak ada data penjualan untuk ditampilkan.</p>`;
        return;
    }

    const chartHTML = `
        <div class="w-full h-full flex gap-2 items-end border-l border-b border-slate-200 pl-2 pb-1">
            ${data.map((value, index) => `
                <div class="flex-1 flex flex-col items-center gap-1 group">
                    <div class="bg-slate-700 text-white text-[10px] font-bold px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        Rp ${value.toLocaleString()}
                    </div>
                    <div class="w-full bg-teal-200 hover:bg-teal-400 transition-colors rounded-t-md" style="height: ${ (value / maxData) * 100 }%;"></div>
                    <div class="text-[10px] text-slate-500">${labels[index].split(' ')[0]}</div>
                </div>
            `).join('')}
        </div>
    `;
    container.innerHTML = chartHTML;
}

// --- DASHBOARD ---
function renderDashboard() {
    // Omzet & Transaksi Hari Ini
    const today = new Date().toDateString();
    const trxHariIni = riwayat.filter(t => new Date(t.tanggal).toDateString() === today);
    const totalOmzetHariIni = trxHariIni.reduce((sum, t) => sum + t.total, 0);
    document.getElementById('db-omzet-hari-ini').innerText = `Rp ${totalOmzetHariIni.toLocaleString()}`;
    document.getElementById('db-transaksi-hari-ini').innerText = trxHariIni.length;

    // Stok Segera Habis (kurang dari 5)
    const lowStockItems = gudang.filter(p => p.stok < 5).sort((a,b) => a.stok - b.stok);
    const lowStockList = document.getElementById('db-low-stock-list');
    if (lowStockItems.length > 0) {
        lowStockList.innerHTML = lowStockItems.map(p => `
            <div class="flex justify-between items-center text-sm p-3 rounded-lg hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                <span class="font-medium text-slate-700">${escapeHtml(p.nama)}</span>
                <span class="font-bold ${p.stok === 0 ? 'text-gray-400' : 'text-red-500'}">Sisa ${p.stok}</span>
            </div>
        `).join('');
    } else {
        lowStockList.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">Semua stok aman.</p>`;
    }

    // Target Omzet
    const target = settings.targetOmzet || 0;
    const progress = target > 0 ? (totalOmzetHariIni / target) * 100 : 0;
    document.getElementById('db-target-progress').style.width = `${Math.min(100, progress)}%`;
    document.getElementById('db-target-percentage').innerText = `${Math.round(progress)}%`;
    document.getElementById('db-target-value').innerText = `dari Rp ${target.toLocaleString()}`;


    // Produk Terlaris Hari Ini
    const topSellingList = document.getElementById('db-top-selling-list');
    
    const productSales = {};
    trxHariIni.forEach(t => {
        t.items.forEach(i => {
            productSales[i.sku] = (productSales[i.sku] || 0) + i.qty;
        });
    });

    const sortedSales = Object.keys(productSales).map(sku => {
        const produk = gudang.find(p => p.sku === sku);
        return {
            nama: produk ? produk.nama : sku,
            qty: productSales[sku]
        };
    }).sort((a, b) => b.qty - a.qty).slice(0, 5);

    if (sortedSales.length > 0) {
        topSellingList.innerHTML = sortedSales.map((p, i) => `
            <div class="flex justify-between items-center p-3 border-b border-slate-100 last:border-b-0">
                <div class="flex items-center gap-3">
                    <span class="font-bold text-slate-400 text-sm w-5 text-center">${i+1}.</span>
                    <span class="text-sm font-medium text-slate-700">${escapeHtml(p.nama)}</span>
                </div>
                <span class="text-xs font-bold bg-teal-50 text-teal-600 px-2 py-1 rounded-md">${p.qty} Terjual</span>
            </div>
        `).join('');
    } else {
        topSellingList.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">Belum ada penjualan hari ini.</p>`;
    }
}

function setTargetOmzet() {
    const newTarget = prompt("Masukkan target omzet harian:", settings.targetOmzet);
    if(newTarget) {
        settings.targetOmzet = parseInt(newTarget) || 0;
        localStorage.setItem('app_settings', JSON.stringify(settings));
        renderDashboard();
    }
}

// --- FITUR BARU: EXPORT CSV ---
function exportLaporanToCSV() {
    if (riwayat.length === 0) {
        return showToast("Tidak ada data laporan untuk diekspor", "info");
    }

    // [FIX] Tambahkan BOM agar Excel bisa membaca karakter UTF-8 (Rupiah, dll) dengan benar
    let csvContent = "data:text/csv;charset=utf-8,%EF%BB%BF";
    csvContent += "ID Transaksi,Tanggal,Waktu,SKU,Nama Produk,Jumlah,Harga Satuan,Subtotal\r\n";

    riwayat.forEach(trx => {
        const tanggal = new Date(trx.tanggal).toLocaleDateString('id-ID');
        const waktu = new Date(trx.tanggal).toLocaleTimeString('id-ID');
        trx.items.forEach(item => {
            const row = [
                `"${trx.id}"`,
                `"${tanggal}"`,
                `"${waktu}"`,
                `"${item.sku}"`,
                `"${item.nama}"`,
                item.qty,
                item.harga,
                item.harga * item.qty
            ].join(",");
            csvContent += row + "\r\n";
        });
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `laporan_transaksi_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Laporan CSV berhasil diunduh", "success");
}

// BACKUP & RESTORE
function backupData() {
    if (gudang.length === 0 && riwayat.length === 0 && pelanggan.length === 0) {
        return showToast("Tidak ada data untuk di-backup", "info");
    }
    const data = { gudang, riwayat, pelanggan, profilToko, settingPajak, stockLog, pengeluaran, vouchers, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_kasirpro_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup data berhasil diunduh", "success");
}

function restoreData(input) {
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if(confirm("Yakin pulihkan data dari file ini? Data saat ini akan ditimpa.")) {
                if(data.gudang) {
                    gudang = data.gudang || [];
                    riwayat = data.riwayat || [];
                    pelanggan = data.pelanggan || [];
                    stockLog = data.stockLog || [];
                    pengeluaran = data.pengeluaran || [];
                    vouchers = data.vouchers || [];
                    settings = data.settings || settings;
                    localStorage.setItem('gudang_data', JSON.stringify(gudang));
                    localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
                    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
                    localStorage.setItem('stock_log', JSON.stringify(stockLog));
                    localStorage.setItem('pengeluaran_data', JSON.stringify(pengeluaran));
                    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
                    localStorage.setItem('app_settings', JSON.stringify(settings));
                    if(data.profilToko) localStorage.setItem('profil_toko', JSON.stringify(data.profilToko));
                    if(data.settingPajak) localStorage.setItem('setting_pajak', data.settingPajak);
                    showToast("Data berhasil dipulihkan!", "success");
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showToast("Format file backup salah!", "error");
                }
            }
        } catch(err) {
            showToast("File backup rusak atau tidak valid!", "error");
        }
    };
    reader.readAsText(file);
    input.value = ''; // Reset input file
}

function resetAplikasi() {
    if(confirm("PERINGATAN: Yakin hapus SEMUA data produk dan transaksi? Aksi ini tidak bisa dikembalikan!")) {
        if(confirm("KONFIRMASI KEDUA: Anda benar-benar yakin ingin menghapus seluruh data?")) {
            localStorage.clear();
            location.reload();
        }
    }
}

// [BARU] Fitur Bersihkan Data Lama
function bersihkanDataLama() {
    if(!confirm("Hapus riwayat transaksi yang lebih lama dari 30 hari untuk menghemat memori?")) return;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const oldLength = riwayat.length;
    riwayat = riwayat.filter(t => new Date(t.tanggal) > thirtyDaysAgo);
    
    if(riwayat.length < oldLength) {
        localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
        renderLaporan();
        showToast(`Berhasil menghapus ${oldLength - riwayat.length} transaksi lama.`, "success");
    } else {
        showToast("Tidak ada data lama yang perlu dihapus.", "info");
    }
}

function resetCart() { 
    if(cart.length > 0 && confirm("Kosongkan semua item di keranjang?")) {
        cart = []; 
        renderCart(); 
    }
}

// Inisialisasi Aplikasi
window.onload = () => { 
    // Set nama toko di header
    document.getElementById('header-nama-toko').innerHTML = profilToko.nama;
    
    // Tampilkan badge owner
    const badge = document.getElementById('user-badge');
    badge.classList.remove('hidden');
    badge.innerText = 'OWNER';
    
    bukaHalaman('dashboard');

    // renderCart(); // Tidak perlu render cart di awal
    updateClock(); // Panggil sekali saat load
    setInterval(updateClock, 1000); // Update tiap detik

    updateNetworkStatus(); // Panggil saat load

    // Tambahkan event listener untuk search dengan debounce
    const searchInput = document.getElementById('in-search');
    const debouncedSearch = debounce((value) => doSearch(value), 300);
    searchInput.addEventListener('keyup', (e) => {
        debouncedSearch(e.target.value);
    });
};

// [BARU] IMPLEMENTASI FITUR MEJA & HUTANG (Missing Functions)
function renderMeja() {
    const container = document.getElementById('grid-meja');
    if(!container) return;
    
    container.innerHTML = mejaData.map(m => `
        <div onclick="pilihMeja(${m.id})" class="p-4 rounded-xl border cursor-pointer flex flex-col items-center justify-center gap-2 transition-all ${m.status === 'terisi' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-teal-50 hover:border-teal-300'}">
            <span class="font-bold text-xl">Meja ${m.id}</span>
            <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${m.status === 'terisi' ? 'bg-red-100' : 'bg-slate-100'}">${m.status}</span>
            ${m.pesanan.length > 0 ? `<span class="text-[10px] bg-white px-2 py-1 rounded-full border shadow-sm mt-1">${m.pesanan.length} Item</span>` : ''}
        </div>
    `).join('');
}

function pilihMeja(id) {
    activeTableId = id;
    const meja = mejaData.find(m => m.id === id);
    if(meja.status === 'terisi') {
        cart = [...meja.pesanan];
        renderCart();
        bukaHalaman('kasir');
        showToast(`Meja ${id} dipilih (Terisi)`, 'info');
    } else {
        if(confirm(`Buka Meja ${id} untuk pesanan baru?`)) {
            meja.status = 'terisi';
            meja.pesanan = [];
            localStorage.setItem('meja_data', JSON.stringify(mejaData));
            renderMeja();
            
            cart = [];
            renderCart();
            bukaHalaman('kasir');
            showToast(`Meja ${id} dibuka`, 'success');
        }
    }
}

function tambahMeja() {
    const id = mejaData.length + 1;
    mejaData.push({ id, status: 'kosong', pesanan: [] });
    localStorage.setItem('meja_data', JSON.stringify(mejaData));
    renderMeja();
    showToast(`Meja ${id} ditambahkan`, 'success');
}

function tutupMejaAktif() {
    activeTableId = null;
}

function renderHutang() {
    const list = document.getElementById('list-hutang');
    if(!list) return;
    
    const yangBerhutang = pelanggan.filter(p => p.hutang && p.hutang > 0);
    
    if(yangBerhutang.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-10 flex flex-col items-center"><svg class="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l4 4a1 1 0 01.586 1.414V19a2 2 0 01-2 2z"></path></svg><span>Tidak ada data hutang.</span></div>';
        return;
    }
    
    list.innerHTML = yangBerhutang.map(p => `
        <div class="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-100 mb-3 shadow-sm">
            <div>
                <div class="font-bold text-slate-800 text-base">${escapeHtml(p.nama)}</div>
                <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(p.nohp)}</div>
            </div>
            <div class="text-right">
                <div class="font-bold text-red-600 text-lg">Rp ${p.hutang.toLocaleString()}</div>
                <button onclick="bayarHutang('${p.id}')" class="text-xs font-bold bg-teal-50 text-teal-700 px-3 py-1.5 rounded-lg mt-1 hover:bg-teal-100 transition">Bayar</button>
            </div>
        </div>
    `).join('');
}

function bayarHutang(id) {
    const p = pelanggan.find(x => x.id === id);
    if(!p) return;
    
    const input = prompt(`Bayar hutang untuk ${p.nama}\nSisa Hutang: Rp ${p.hutang.toLocaleString()}\n\nMasukkan nominal pembayaran:`);
    if(input) {
        const nominal = parseInt(input.replace(/\D/g,''));
        if(!nominal || nominal <= 0) return showToast("Nominal tidak valid", "error");
        
        if(nominal > p.hutang) {
            showToast("Nominal melebihi sisa hutang!", "error");
            return;
        }
        
        p.hutang -= nominal;
        localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
        renderHutang();
        showToast(`Pembayaran Rp ${nominal.toLocaleString()} berhasil diterima`, "success");
    }
}
