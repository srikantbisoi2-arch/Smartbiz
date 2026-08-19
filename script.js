// Firebase Realtime Database URL
const FIREBASE_DB_URL = "https://smartldger-default-rtdb.firebaseio.com/transactions";

// Global State Management
let billingRecords = []; 
let syncedDatabaseRecords = []; 
let slCounter = 1001;
let editingRecordIndex = -1;
let cameraStream = null;

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  initFormDefaults();
  loadInitialData();

  // Mobile WebView / Hopweb Camera Permissions Warm-up
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        stream.getTracks().forEach(track => track.stop());
      })
      .catch(() => {});
  }
});

// Toast notification helper message
function showToastMessage(message) {
  const toast = document.getElementById('toast-msg');
  if (toast) {
    toast.innerText = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3500);
  }
}

// Load records initially from Firebase and sync Serial Number Counter
async function loadInitialData() {
  try {
    const response = await fetch(`${FIREBASE_DB_URL}.json`);
    const data = await response.json();
    billingRecords = [];

    let maxSlNo = 1000;

    if (data) {
      Object.keys(data).forEach(firebaseKey => {
        const item = data[firebaseKey];
        billingRecords.unshift({
          fbKey: firebaseKey,
          ...item
        });

        if (item.slNo && item.slNo.startsWith("SL-")) {
          const numPart = parseInt(item.slNo.replace("SL-", ""), 10);
          if (!isNaN(numPart) && numPart > maxSlNo) {
            maxSlNo = numPart;
          }
        }
      });
    }

    slCounter = maxSlNo + 1;
    initFormDefaults();
    renderReports();
  } catch (error) {
    console.error("Firebase Load Error:", error);
  }
}

// ----------------------------------------------------
// OCR CAMERA SCANNER LOGIC
// ----------------------------------------------------

function validateAadhaarInput(input) {
  input.value = input.value.replace(/[^0-9]/g, '').slice(0, 12);
}

async function openCameraModal() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');
  const statusElem = document.getElementById('ocr-popup-status');

  if (modal) modal.style.display = 'flex';
  if (statusElem) statusElem.style.display = 'none';

  if (!video) return;

  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const cameraConfigs = [
    { video: { facingMode: { exact: "environment" } } },
    { video: { facingMode: "environment" } },
    { video: true }
  ];

  for (let config of cameraConfigs) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(config);
      video.srcObject = cameraStream;
      await video.play();
      return;
    } catch (e) {}
  }

  alert("Camera access denied or unavailable on this device.");
}

function closeCameraModal() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (video) video.srcObject = null;
  if (modal) modal.style.display = 'none';
}

async function captureAndScanOCR() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  const statusElem = document.getElementById('ocr-popup-status');

  if (!video || !canvas || !video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (statusElem) {
    statusElem.style.display = 'block';
    statusElem.innerText = 'Scanning image... Please wait.';
  }

  canvas.toBlob(async (blob) => {
    if (blob) {
      await runTesseractOCR(blob);
    } else {
      alert("Failed to capture frame.");
    }
  }, 'image/png');
}

async function processFileOCR(event) {
  const file = event.target.files[0];
  if (file) {
    const statusElem = document.getElementById('ocr-popup-status');
    if (statusElem) {
      statusElem.style.display = 'block';
      statusElem.innerText = 'Scanning uploaded image...';
    }
    await runTesseractOCR(file);
  }
}

async function runTesseractOCR(imageSource) {
  const statusElem = document.getElementById('ocr-popup-status');

  try {
    const worker = await Tesseract.createWorker('eng');
    const ret = await worker.recognize(imageSource);
    await worker.terminate();

    const scannedText = ret.data.text;
    const digitsOnly = scannedText.replace(/[^0-9]/g, '');
    const matchedNumber = scannedText.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);

    let extractedNumber = '';

    if (matchedNumber) {
      extractedNumber = matchedNumber[0].replace(/\s/g, '');
    } else if (digitsOnly.length >= 12) {
      extractedNumber = digitsOnly.substring(0, 12);
    }

    if (extractedNumber && extractedNumber.length === 12) {
      const inputField = document.getElementById('cust-id');
      if (inputField) {
        inputField.value = extractedNumber;
      }
      showToastMessage("12-Digit Number Scanned & Filled!");
      closeCameraModal();
    } else {
      alert("Could not detect a valid 12-digit number. Please enter manually.");
      if (statusElem) statusElem.innerText = 'Detection failed.';
    }
  } catch (err) {
    console.error("OCR Processing Error:", err);
    alert("Scan error. Please enter manually.");
  } finally {
    if (statusElem) statusElem.style.display = 'none';
  }
}

// ----------------------------------------------------
// DASHBOARD & NAVIGATION LOGIC
// ----------------------------------------------------

function openSection(sectionId) {
  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.style.display = 'none';

  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.style.display = 'none';
  });

  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.style.display = 'block';
  }
}

function goBackToDashboard() {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.style.display = 'none';
  });

  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.style.display = 'block';
}

// ----------------------------------------------------
// TRANSACTION & BILLING LOGIC
// ----------------------------------------------------

function initFormDefaults() {
  const serialElem = document.getElementById('serial-no');
  const dateElem = document.getElementById('date-time');

  const now = new Date();
  const formattedDateTime = now.toLocaleDateString('en-IN') + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  if (serialElem && editingRecordIndex === -1) {
    serialElem.value = "SL-" + slCounter;
  }
  if (dateElem && editingRecordIndex === -1) {
    dateElem.value = formattedDateTime;
  }
}

function calculatePending() {
  const withdraw = parseFloat(document.getElementById('withdraw-amt')?.value) || 0;
  const paying = parseFloat(document.getElementById('paying-amt')?.value) || 0;

  const pending = withdraw - paying;
  const pendingElem = document.getElementById('pending-amt');
  if (pendingElem) {
    pendingElem.value = pending >= 0 ? pending.toFixed(2) : "0.00";
  }
}

async function submitTransaction(type = 'Credit') {
  const nameInput = document.getElementById('cust-name');
  if (!nameInput || !nameInput.value.trim()) {
    alert("Please enter customer name.");
    return;
  }

  const custName = nameInput.value.trim();
  const withdraw = parseFloat(document.getElementById('withdraw-amt')?.value) || 0;
  const paying = parseFloat(document.getElementById('paying-amt')?.value) || 0;
  const pending = parseFloat(document.getElementById('pending-amt')?.value) || 0;
  const serialNo = document.getElementById('serial-no')?.value || ("SL-" + slCounter);
  const dateTime = document.getElementById('date-time')?.value || new Date().toLocaleString('en-IN');
  const idRef = document.getElementById('cust-id')?.value.trim() || '-';
  const remarks = document.getElementById('remarks')?.value.trim() || '-';

  const recordPayload = {
    slNo: serialNo,
    dateTime: dateTime,
    name: custName,
    aadhaar: idRef,
    withdraw: withdraw,
    paying: paying,
    pending: pending,
    remarks: remarks,
    type: type
  };

  let savedRecord = { ...recordPayload };

  if (editingRecordIndex > -1) {
    const currentRecord = billingRecords[editingRecordIndex];
    const fbKey = currentRecord.fbKey;

    recordPayload.fbKey = fbKey;
    billingRecords[editingRecordIndex] = recordPayload;

    if (fbKey) {
      try {
        await fetch(`${FIREBASE_DB_URL}/${fbKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slNo: serialNo, dateTime, name: custName, aadhaar: idRef,
            withdraw, paying, pending, remarks, type
          })
        });
        showToastMessage("Record updated in Firebase!");
      } catch (err) {
        console.error("Firebase Edit Error:", err);
      }
    }
    editingRecordIndex = -1;
  } else {
    try {
      const response = await fetch(`${FIREBASE_DB_URL}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordPayload)
      });
      const resData = await response.json();
      
      if (resData && resData.name) {
        savedRecord.fbKey = resData.name;
      }

      billingRecords.unshift(savedRecord);
      slCounter++;
      showToastMessage("Transaction saved successfully!");
    } catch (error) {
      console.error("Firebase Save Error:", error);
      billingRecords.unshift(savedRecord);
      slCounter++;
      showToastMessage("Saved locally!");
    }
  }

  renderReports();
  resetBillingForm();
  goBackToDashboard();

  openEBillFromRecord(savedRecord);
}

function resetBillingForm() {
  if (document.getElementById('cust-name')) document.getElementById('cust-name').value = '';
  if (document.getElementById('cust-id')) document.getElementById('cust-id').value = '';
  if (document.getElementById('withdraw-amt')) document.getElementById('withdraw-amt').value = '';
  if (document.getElementById('paying-amt')) document.getElementById('paying-amt').value = '';
  if (document.getElementById('pending-amt')) document.getElementById('pending-amt').value = '';
  if (document.getElementById('remarks')) document.getElementById('remarks').value = '';

  editingRecordIndex = -1;
  initFormDefaults();
  calculatePending();
}

// ----------------------------------------------------
// REPORTS MANAGEMENT
// ----------------------------------------------------

function renderReports() {
  const tbody = document.getElementById('reports-list');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (billingRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 20px; color: #6b7280;">No records found.</td></tr>`;
    return;
  }

  billingRecords.forEach((record, index) => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${record.slNo}</strong></td>
        <td><small>${record.dateTime}</small></td>
        <td>${record.name}</td>
        <td><small>${record.aadhaar}</small></td>
        <td>₹${record.withdraw.toFixed(2)}</td>
        <td>₹${record.paying.toFixed(2)}</td>
        <td style="color: ${record.pending > 0 ? '#dc2626' : '#16a34a'}; font-weight: bold;">₹${record.pending.toFixed(2)}</td>
        <td>${record.remarks}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="t-btn t-btn-accent" style="padding: 6px 10px; font-size: 0.8rem;" onclick="editReportRecord(${index})">✏️ Edit</button>
            <button class="t-btn t-btn-warning" style="padding: 6px 10px; font-size: 0.8rem; background:#ef4444;" onclick="deleteReportRecord(${index})">🗑️ Delete</button>
          </div>
        </td>
      </tr>
    `;
  });
}

function editReportRecord(index) {
  const record = billingRecords[index];
  editingRecordIndex = index;

  openSection('billing');

  if (document.getElementById('serial-no')) document.getElementById('serial-no').value = record.slNo;
  if (document.getElementById('date-time')) document.getElementById('date-time').value = record.dateTime;
  if (document.getElementById('cust-name')) document.getElementById('cust-name').value = record.name;
  if (document.getElementById('cust-id')) document.getElementById('cust-id').value = record.aadhaar !== '-' ? record.aadhaar : '';
  if (document.getElementById('withdraw-amt')) document.getElementById('withdraw-amt').value = record.withdraw;
  if (document.getElementById('paying-amt')) document.getElementById('paying-amt').value = record.paying;
  if (document.getElementById('remarks')) document.getElementById('remarks').value = record.remarks !== '-' ? record.remarks : '';

  calculatePending();
}

async function deleteReportRecord(index) {
  if (confirm("Are you sure you want to delete this record?")) {
    const record = billingRecords[index];
    
    if (record && record.fbKey) {
      try {
        await fetch(`${FIREBASE_DB_URL}/${record.fbKey}.json`, {
          method: 'DELETE'
        });
        showToastMessage("Record deleted from Firebase.");
      } catch (err) {
        console.error("Firebase Delete Error:", err);
      }
    }

    billingRecords.splice(index, 1);
    renderReports();
  }
}

function filterReports() {
  const query = document.getElementById('report-search')?.value.toLowerCase() || '';
  const rows = document.querySelectorAll('#reports-list tr');

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

// ----------------------------------------------------
// FIREBASE SYNC-IN DATA SYSTEM
// ----------------------------------------------------

async function syncInFromDatabase() {
  const tbody = document.getElementById('syncin-list');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 20px;">Fetching records from Firebase...</td></tr>`;
  }

  try {
    const response = await fetch(`${FIREBASE_DB_URL}.json`);
    const data = await response.json();

    syncedDatabaseRecords = [];

    if (data) {
      Object.keys(data).forEach(key => {
        syncedDatabaseRecords.unshift({
          fbKey: key,
          ...data[key]
        });
      });
    }

    renderSyncInList();
    showToastMessage("Data synced from Firebase!");
  } catch (error) {
    console.error("Firebase Fetch Error:", error);
    showToastMessage("Failed to fetch Firebase data.");
    renderSyncInList();
  }
}

function renderSyncInList() {
  const tbody = document.getElementById('syncin-list');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (syncedDatabaseRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 20px; color: #6b7280;">Click 'Sync-In Data' to fetch records from Firebase.</td></tr>`;
    return;
  }

  syncedDatabaseRecords.forEach((record, index) => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${record.slNo}</strong></td>
        <td><small>${record.dateTime}</small></td>
        <td>${record.name}</td>
        <td><small>${record.aadhaar}</small></td>
        <td>₹${parseFloat(record.withdraw || 0).toFixed(2)}</td>
        <td>₹${parseFloat(record.paying || 0).toFixed(2)}</td>
        <td style="color: ${(record.pending || 0) > 0 ? '#dc2626' : '#16a34a'}; font-weight: bold;">₹${parseFloat(record.pending || 0).toFixed(2)}</td>
        <td>
          <button class="t-btn t-btn-accent" style="padding: 6px 12px; font-size: 0.85rem;" onclick="openEBillModal(${index})">🧾 E-Bill</button>
        </td>
      </tr>
    `;
  });
}

function filterSyncData() {
  const query = document.getElementById('sync-search')?.value.toLowerCase() || '';
  const rows = document.querySelectorAll('#syncin-list tr');

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

// ----------------------------------------------------
// E-BILL MODAL, HOPWEB SAFE BLOB DOWNLOAD & RAWBT PRINT
// ----------------------------------------------------

function openEBillFromRecord(record) {
  if (!record) return;

  if (document.getElementById('e-sl')) document.getElementById('e-sl').innerText = record.slNo || '-';
  if (document.getElementById('e-datetime')) document.getElementById('e-datetime').innerText = record.dateTime || '-';
  if (document.getElementById('e-name')) document.getElementById('e-name').innerText = record.name || '-';
  if (document.getElementById('e-aadhaar')) document.getElementById('e-aadhaar').innerText = record.aadhaar || '-';
  if (document.getElementById('e-withdraw')) document.getElementById('e-withdraw').innerText = parseFloat(record.withdraw || 0).toFixed(2);
  if (document.getElementById('e-paying')) document.getElementById('e-paying').innerText = parseFloat(record.paying || 0).toFixed(2);
  if (document.getElementById('e-pending')) document.getElementById('e-pending').innerText = parseFloat(record.pending || 0).toFixed(2);
  if (document.getElementById('e-remarks')) document.getElementById('e-remarks').innerText = record.remarks || '-';

  const modal = document.getElementById('ebill-modal');
  if (modal) modal.style.display = 'flex';
}

function openEBillModal(index) {
  const record = syncedDatabaseRecords[index];
  openEBillFromRecord(record);
}

function closeEBillModal() {
  const modal = document.getElementById('ebill-modal');
  if (modal) modal.style.display = 'none';
}

// HOPWEB / ANDROID WEBVIEW SAFE DOWNLOAD ENGINE
async function downloadEBillReceipt(format = 'jpg') {
  const element = document.getElementById('ebill-printable');
  const slNo = document.getElementById('e-sl')?.innerText || 'Receipt';

  if (!element) {
    alert("Receipt element not found!");
    return;
  }

  showToastMessage("Downloading...");

  try {
    const canvas = await html2canvas(element, { 
      scale: 2, 
      useCORS: true, 
      logging: false,
      backgroundColor: '#ffffff'
    });

    if (format.toLowerCase() === 'pdf' && window.jspdf) {
      // PDF GENERATION & BLOB CONVERSION
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const imgWidth = 190;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'JPEG', 10, 10, imgWidth, imgHeight);

      const pdfBlob = pdf.output('blob');
      executeHopwebDirectDownload(pdfBlob, `Invoice_${slNo}.pdf`, 'application/pdf');
      showToastMessage("PDF Downloaded!");

    } else {
      // JPG / PNG GENERATION & BLOB CONVERSION
      const mimeType = format.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
      const fileExt = format.toLowerCase() === 'png' ? 'png' : 'jpg';

      canvas.toBlob((blob) => {
        if (!blob) {
          alert("Failed to create file.");
          return;
        }
        executeHopwebDirectDownload(blob, `Invoice_${slNo}.${fileExt}`, mimeType);
        showToastMessage(`${fileExt.toUpperCase()} Downloaded!`);
      }, mimeType, 0.98);
    }

  } catch (err) {
    console.error("Direct download error:", err);
    window.print();
  }
}

// HOPWEB & MOBILE WEBVIEW BLOB EXPORT ENGINE
function executeHopwebDirectDownload(blobOrData, filename, mimeType) {
  let blob;
  if (blobOrData instanceof Blob) {
    blob = blobOrData;
  } else {
    blob = new Blob([blobOrData], { type: mimeType });
  }

  const blobUrl = URL.createObjectURL(blob);

  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = filename;
  downloadLink.style.display = 'none';

  document.body.appendChild(downloadLink);
  downloadLink.click();

  setTimeout(() => {
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(blobUrl);
  }, 10000);
}

// RAWBT THERMAL PRINTER INTENT
function printEBillThermal() {
  const slNo = document.getElementById('e-sl')?.innerText || '-';
  const dateTime = document.getElementById('e-datetime')?.innerText || '-';
  const name = document.getElementById('e-name')?.innerText || '-';
  const aadhaar = document.getElementById('e-aadhaar')?.innerText || '-';
  const withdraw = document.getElementById('e-withdraw')?.innerText || '0.00';
  const paying = document.getElementById('e-paying')?.innerText || '0.00';
  const pending = document.getElementById('e-pending')?.innerText || '0.00';
  const remarks = document.getElementById('e-remarks')?.innerText || '-';

  const rawReceiptText = 
    "SMART LEDGER\n" +
    "Transaction Receipt\n" +
    "--------------------------------\n" +
    `Invoice No : ${slNo}\n` +
    `Date/Time  : ${dateTime}\n` +
    `Customer   : ${name}\n` +
    `ID Ref     : ${aadhaar}\n` +
    "--------------------------------\n" +
    `Withdraw   : Rs. ${withdraw}\n` +
    `Paid Amt   : Rs. ${paying}\n` +
    `Pending    : Rs. ${pending}\n` +
    `Remarks    : ${remarks}\n` +
    "--------------------------------\n" +
    "Thank You For Business!\n\n\n";

  try {
    showToastMessage("Opening Thermal Printer...");
    
    const encodedText = encodeURIComponent(rawReceiptText);
    const intentUrl = `intent:${encodedText}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    
    window.location.href = intentUrl;
  } catch (err) {
    console.error("Thermal Print Error:", err);
    window.print();
  }
}