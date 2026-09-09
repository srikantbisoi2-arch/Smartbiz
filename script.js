// Cloudinary Configurations
const CLOUDINARY_CLOUD_NAME = "dpgprpc3h";
const CLOUDINARY_UPLOAD_PRESET = "my shop";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// Firebase Realtime Database URLs
const AEPS_FIREBASE_DB_URL = "https://smartldger-default-rtdb.firebaseio.com/transactions";
const SC_FIREBASE_DB_URL = "https://smartldger-default-rtdb.firebaseio.com/sc_transactions";

// Global State Management - AEPS
let billingRecords = JSON.parse(localStorage.getItem('aeps_local_records')) || []; 
let syncedDatabaseRecords = []; 
let slCounter = parseInt(localStorage.getItem('aeps_sl_counter')) || 1001;
let editingRecordIndex = -1;
let editingCloudRecordKey = null;

// Global State Management - Shop (S.C)
let scBillingRecords = JSON.parse(localStorage.getItem('sc_local_records')) || [];
let scSyncedDatabaseRecords = [];
let scSlCounter = parseInt(localStorage.getItem('sc_sl_counter')) || 1;
let scEditingRecordIndex = -1;
let scEditingCloudRecordKey = null;

let cameraStream = null;
let currentOcrTargetId = 'cust-id';

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  initFormDefaults();
  initScFormDefaults();
  renderReports();
  renderScReports();
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

// Format counter to S.C0001 format
function formatScSerialNo(num) {
  return "S.C" + String(num).padStart(4, '0');
}

// ----------------------------------------------------
// LOCAL PHOTO HANDLING & CLOUDINARY UPLOAD LOGIC
// ----------------------------------------------------

function handleLocalPhotoSelect(event, formType) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Image = e.target.result;
    document.getElementById(`${formType}-photo-url`).value = base64Image;
    const statusElem = document.getElementById(`${formType}-upload-status`);
    if (statusElem) {
      statusElem.classList.remove('hidden');
      statusElem.innerText = "✓ Photo Captured Locally!";
      statusElem.style.color = "#059669";
    }
    showToastMessage("Photo stored in local memory.");
  };
  reader.readAsDataURL(file);
}

async function uploadBase64ToCloudinary(base64String) {
  if (!base64String || !base64String.startsWith('data:image')) {
    return base64String;
  }

  const formData = new FormData();
  formData.append('file', base64String);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  try {
    const response = await fetch(CLOUDINARY_UPLOAD_URL, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    return data.secure_url || base64String;
  } catch (err) {
    console.error("Cloudinary Upload Error:", err);
    return base64String;
  }
}

function viewPhotoModal(photoUrl) {
  if (!photoUrl || photoUrl === '-') {
    alert("No photo attached for this record.");
    return;
  }
  const modal = document.getElementById('photo-viewer-modal');
  const img = document.getElementById('viewer-img');
  if (img) img.src = photoUrl;
  if (modal) modal.style.display = 'flex';
}

function closePhotoViewer() {
  const modal = document.getElementById('photo-viewer-modal');
  if (modal) modal.style.display = 'none';
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

  if (sectionId === 'billing') initFormDefaults();
  if (sectionId === 'sc-billing') initScFormDefaults();
}

function goBackToDashboard() {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.style.display = 'none';
  });

  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.style.display = 'block';
}

// ----------------------------------------------------
// 1. AEPS LOCAL SAVE, EDIT & SYNC LOGIC
// ----------------------------------------------------

async function fetchLatestAepsSerialNo() {
  const serialElem = document.getElementById('serial-no');
  if (!serialElem) return;

  try {
    const response = await fetch(`${AEPS_FIREBASE_DB_URL}.json`);
    const data = await response.json();

    let maxSl = 1000;

    if (data) {
      Object.values(data).forEach(item => {
        if (item.slNo) {
          const num = parseInt(item.slNo.replace(/[^0-9]/g, '')) || 0;
          if (num > maxSl) maxSl = num;
        }
      });
    }

    billingRecords.forEach(item => {
      if (item.slNo) {
        const num = parseInt(item.slNo.replace(/[^0-9]/g, '')) || 0;
        if (num > maxSl) maxSl = num;
      }
    });

    slCounter = maxSl + 1;
    localStorage.setItem('aeps_sl_counter', slCounter);

    if (editingRecordIndex === -1 && !editingCloudRecordKey) {
      serialElem.value = "SL-" + slCounter;
    }
  } catch (err) {
    console.error("Error fetching latest AEPS SL No:", err);
    if (editingRecordIndex === -1 && !editingCloudRecordKey) {
      serialElem.value = "SL-" + slCounter;
    }
  }
}

function initFormDefaults() {
  const dateElem = document.getElementById('date-time');
  const now = new Date();
  const formattedDateTime = now.toLocaleDateString('en-IN') + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  if (dateElem && editingRecordIndex === -1 && !editingCloudRecordKey) {
    dateElem.value = formattedDateTime;
  }

  fetchLatestAepsSerialNo();
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
  const photoUrl = document.getElementById('aeps-photo-url')?.value || '-';

  const recordPayload = {
    slNo: serialNo,
    dateTime: dateTime,
    name: custName,
    aadhaar: idRef,
    withdraw: withdraw,
    paying: paying,
    pending: pending,
    remarks: remarks,
    photoUrl: photoUrl,
    type: type,
    isSynced: false,
    isEdited: false
  };

  if (editingCloudRecordKey) {
    try {
      let finalPhoto = photoUrl;
      if (photoUrl && photoUrl.startsWith('data:image')) {
        finalPhoto = await uploadBase64ToCloudinary(photoUrl);
      }
      const cloudPayload = { ...recordPayload, photoUrl: finalPhoto, isSynced: true, fbKey: editingCloudRecordKey };
      
      await fetch(`${AEPS_FIREBASE_DB_URL}/${editingCloudRecordKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudPayload)
      });
      showToastMessage("Cloud AEPS Record updated!");
      editingCloudRecordKey = null;
      syncInFromDatabase();
      openSection('syncin');
    } catch (e) {
      console.error(e);
      showToastMessage("Failed to update Cloud Record.");
    }
  } else if (editingRecordIndex > -1) {
    billingRecords[editingRecordIndex] = { ...billingRecords[editingRecordIndex], ...recordPayload, isSynced: false, isEdited: true };
    editingRecordIndex = -1;
    showToastMessage("AEPS Record updated locally!");
    localStorage.setItem('aeps_local_records', JSON.stringify(billingRecords));
    renderReports();
    openSection('aeps-menu');
  } else {
    billingRecords.unshift(recordPayload);
    slCounter++;
    localStorage.setItem('aeps_sl_counter', slCounter);
    showToastMessage("AEPS Entry saved locally!");
    localStorage.setItem('aeps_local_records', JSON.stringify(billingRecords));
    renderReports();
    openSection('aeps-menu');
  }

  resetBillingForm();
  openEBillFromRecord(recordPayload);
}

function resetBillingForm() {
  if (document.getElementById('cust-name')) document.getElementById('cust-name').value = '';
  if (document.getElementById('cust-id')) document.getElementById('cust-id').value = '';
  if (document.getElementById('withdraw-amt')) document.getElementById('withdraw-amt').value = '';
  if (document.getElementById('paying-amt')) document.getElementById('paying-amt').value = '';
  if (document.getElementById('pending-amt')) document.getElementById('pending-amt').value = '';
  if (document.getElementById('remarks')) document.getElementById('remarks').value = '';
  if (document.getElementById('aeps-photo-url')) document.getElementById('aeps-photo-url').value = '';
  if (document.getElementById('aeps-photo-input')) document.getElementById('aeps-photo-input').value = '';
  
  const statusElem = document.getElementById('aeps-upload-status');
  if (statusElem) statusElem.classList.add('hidden');

  editingRecordIndex = -1;
  editingCloudRecordKey = null;
  initFormDefaults();
  calculatePending();
}

function renderReports() {
  const tbody = document.getElementById('reports-list');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (billingRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-gray-500">No AEPS records found locally.</td></tr>`;
    return;
  }

  billingRecords.forEach((record, index) => {
    let photoBtn = record.photoUrl && record.photoUrl !== '-' 
      ? `<button class="t-btn t-btn-primary px-2 py-1 text-xs" onclick="viewPhotoModal('${record.photoUrl}')">📷 View</button>` 
      : '-';

    let syncBadge = record.isSynced 
      ? `<span class="bg-emerald-100 text-emerald-800 text-xs px-2 py-1 rounded-full font-bold">Synced ✔️</span>` 
      : `<span class="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded-full font-bold">Pending ⏳</span>`;

    // Edit button enable ONLY IF pending amount > 0
    let hasPending = parseFloat(record.pending || 0) > 0;
    let actionBtnHTML = hasPending 
      ? `<button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="editReportRecord(${index})">✏️ Edit</button>` 
      : `<span class="text-xs text-gray-400 italic">No Pending</span>`;

    tbody.innerHTML += `
      <tr>
        <td><strong>${record.slNo}</strong></td>
        <td><small>${record.dateTime}</small></td>
        <td>${record.name}</td>
        <td><small>${record.aadhaar}</small></td>
        <td>₹${parseFloat(record.withdraw || 0).toFixed(2)}</td>
        <td>₹${parseFloat(record.paying || 0).toFixed(2)}</td>
        <td class="font-bold ${(record.pending || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}">₹${parseFloat(record.pending || 0).toFixed(2)}</td>
        <td>${photoBtn}</td>
        <td>${syncBadge}</td>
        <td>${actionBtnHTML}</td>
      </tr>
    `;
  });
}

function editReportRecord(index) {
  const record = billingRecords[index];
  editingRecordIndex = index;
  editingCloudRecordKey = null;

  openSection('billing');

  if (document.getElementById('serial-no')) document.getElementById('serial-no').value = record.slNo;
  if (document.getElementById('date-time')) document.getElementById('date-time').value = record.dateTime;
  if (document.getElementById('cust-name')) document.getElementById('cust-name').value = record.name;
  if (document.getElementById('cust-id')) document.getElementById('cust-id').value = record.aadhaar !== '-' ? record.aadhaar : '';
  if (document.getElementById('withdraw-amt')) document.getElementById('withdraw-amt').value = record.withdraw;
  if (document.getElementById('paying-amt')) document.getElementById('paying-amt').value = record.paying;
  if (document.getElementById('remarks')) document.getElementById('remarks').value = record.remarks !== '-' ? record.remarks : '';
  if (document.getElementById('aeps-photo-url')) document.getElementById('aeps-photo-url').value = record.photoUrl || '-';

  calculatePending();
}

async function syncOutAepsData() {
  const unsynced = billingRecords.filter(r => !r.isSynced);
  if (unsynced.length === 0) {
    showToastMessage("All records are already synced!");
    return;
  }

  showToastMessage("Syncing records to Database...");

  for (let record of billingRecords) {
    if (!record.isSynced) {
      try {
        if (record.photoUrl && record.photoUrl.startsWith('data:image')) {
          record.photoUrl = await uploadBase64ToCloudinary(record.photoUrl);
        }

        const cloudPayload = { ...record, isSynced: true };

        let response;
        if (record.fbKey) {
          response = await fetch(`${AEPS_FIREBASE_DB_URL}/${record.fbKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudPayload)
          });
        } else {
          response = await fetch(`${AEPS_FIREBASE_DB_URL}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudPayload)
          });
          const resData = await response.json();
          if (resData && resData.name) record.fbKey = resData.name;
        }

        record.isSynced = true;
      } catch (err) {
        console.error("Sync-out Error:", err);
      }
    }
  }

  localStorage.setItem('aeps_local_records', JSON.stringify(billingRecords));
  renderReports();
  showToastMessage("AEPS Sync-Out Completed ✔️");
}

function filterReports() {
  const query = document.getElementById('report-search')?.value.toLowerCase() || '';
  const rows = document.querySelectorAll('#reports-list tr');

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

async function syncInFromDatabase() {
  const tbody = document.getElementById('syncin-list');
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">Fetching records...</td></tr>`;

  try {
    const response = await fetch(`${AEPS_FIREBASE_DB_URL}.json`);
    const data = await response.json();

    syncedDatabaseRecords = [];

    if (data) {
      Object.keys(data).forEach(key => {
        syncedDatabaseRecords.unshift({
          fbKey: key,
          photoUrl: data[key].photoUrl || '-',
          ...data[key]
        });
      });
    }

    renderSyncInList();
    showToastMessage("AEPS Cloud Data Fetched!");
  } catch (error) {
    console.error("AEPS Sync Error:", error);
    showToastMessage("Failed to fetch AEPS data.");
    renderSyncInList();
  }
}

function renderSyncInList() {
  const tbody = document.getElementById('syncin-list');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (syncedDatabaseRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-gray-500">Click 'Fetch Database' to view cloud records.</td></tr>`;
    return;
  }

  syncedDatabaseRecords.forEach((record, index) => {
    let photoBtn = record.photoUrl && record.photoUrl !== '-' 
      ? `<button class="t-btn t-btn-primary px-2 py-1 text-xs" onclick="viewPhotoModal('${record.photoUrl}')">📷 View</button>` 
      : '-';

    tbody.innerHTML += `
      <tr>
        <td><strong>${record.slNo}</strong></td>
        <td><small>${record.dateTime}</small></td>
        <td>${record.name}</td>
        <td><small>${record.aadhaar}</small></td>
        <td>₹${parseFloat(record.withdraw || 0).toFixed(2)}</td>
        <td>₹${parseFloat(record.paying || 0).toFixed(2)}</td>
        <td class="font-bold ${(record.pending || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}">₹${parseFloat(record.pending || 0).toFixed(2)}</td>
        <td>${photoBtn}</td>
        <td>
          <div class="flex gap-1">
            <button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="editCloudRecord(${index})">✏️ Edit</button>
            <button class="t-btn t-btn-primary px-2 py-1 text-xs" onclick="openEBillModal(${index})">🧾 Bill</button>
            <button class="t-btn t-btn-warning px-2 py-1 text-xs bg-red-600" onclick="deleteSyncRecord(${index})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  });
}

function editCloudRecord(index) {
  const record = syncedDatabaseRecords[index];
  editingCloudRecordKey = record.fbKey;
  editingRecordIndex = -1;

  openSection('billing');

  if (document.getElementById('serial-no')) document.getElementById('serial-no').value = record.slNo;
  if (document.getElementById('date-time')) document.getElementById('date-time').value = record.dateTime;
  if (document.getElementById('cust-name')) document.getElementById('cust-name').value = record.name;
  if (document.getElementById('cust-id')) document.getElementById('cust-id').value = record.aadhaar !== '-' ? record.aadhaar : '';
  if (document.getElementById('withdraw-amt')) document.getElementById('withdraw-amt').value = record.withdraw;
  if (document.getElementById('paying-amt')) document.getElementById('paying-amt').value = record.paying;
  if (document.getElementById('remarks')) document.getElementById('remarks').value = record.remarks !== '-' ? record.remarks : '';
  if (document.getElementById('aeps-photo-url')) document.getElementById('aeps-photo-url').value = record.photoUrl || '-';

  calculatePending();
}

async function deleteSyncRecord(index) {
  if (confirm("Delete this record permanently from cloud?")) {
    const record = syncedDatabaseRecords[index];

    if (record && record.fbKey) {
      try {
        await fetch(`${AEPS_FIREBASE_DB_URL}/${record.fbKey}.json`, { method: 'DELETE' });
        showToastMessage("Cloud Record deleted.");
      } catch (err) {
        console.error("AEPS Delete Error:", err);
      }
    }

    syncedDatabaseRecords.splice(index, 1);
    billingRecords = billingRecords.filter(r => r.fbKey !== record.fbKey);
    localStorage.setItem('aeps_local_records', JSON.stringify(billingRecords));
    renderSyncInList();
    renderReports();
  }
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
// 2. SHOP TRANSACTIONS (S.C) LOCAL & SYNC LOGIC
// ----------------------------------------------------

async function fetchLatestScSerialNo() {
  const serialElem = document.getElementById('sc-serial-no');
  if (!serialElem) return;

  try {
    const response = await fetch(`${SC_FIREBASE_DB_URL}.json`);
    const data = await response.json();

    let maxSl = 0;

    if (data) {
      Object.values(data).forEach(item => {
        if (item.slNo) {
          const num = parseInt(item.slNo.replace(/[^0-9]/g, '')) || 0;
          if (num > maxSl) maxSl = num;
        }
      });
    }

    scBillingRecords.forEach(item => {
      if (item.slNo) {
        const num = parseInt(item.slNo.replace(/[^0-9]/g, '')) || 0;
        if (num > maxSl) maxSl = num;
      }
    });

    scSlCounter = maxSl + 1;
    localStorage.setItem('sc_sl_counter', scSlCounter);

    if (scEditingRecordIndex === -1 && !scEditingCloudRecordKey) {
      serialElem.value = formatScSerialNo(scSlCounter);
    }
  } catch (err) {
    console.error("Error fetching latest Shop SL No:", err);
    if (scEditingRecordIndex === -1 && !scEditingCloudRecordKey) {
      serialElem.value = formatScSerialNo(scSlCounter);
    }
  }
}

function initScFormDefaults() {
  const dateElem = document.getElementById('sc-date-time');
  const now = new Date();
  const formattedDateTime = now.toLocaleDateString('en-IN') + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  if (dateElem && scEditingRecordIndex === -1 && !scEditingCloudRecordKey) {
    dateElem.value = formattedDateTime;
  }

  fetchLatestScSerialNo();
}

function calculateScPending() {
  const total = parseFloat(document.getElementById('sc-total-amt')?.value) || 0;
  const paid = parseFloat(document.getElementById('sc-paid-amt')?.value) || 0;

  const pending = total - paid;
  const pendingElem = document.getElementById('sc-pending-amt');
  if (pendingElem) {
    pendingElem.value = pending >= 0 ? pending.toFixed(2) : "0.00";
  }
}

async function submitScTransaction() {
  const nameInput = document.getElementById('sc-cust-name');
  if (!nameInput || !nameInput.value.trim()) {
    alert("Please enter Applicant Name.");
    return;
  }

  const custName = nameInput.value.trim();
  const serviceName = document.getElementById('sc-service-name')?.value.trim() || '-';
  const totalAmt = parseFloat(document.getElementById('sc-total-amt')?.value) || 0;
  const paidAmt = parseFloat(document.getElementById('sc-paid-amt')?.value) || 0;
  const pendingAmt = parseFloat(document.getElementById('sc-pending-amt')?.value) || 0;
  const serialNo = document.getElementById('sc-serial-no')?.value || formatScSerialNo(scSlCounter);
  const dateTime = document.getElementById('sc-date-time')?.value || new Date().toLocaleString('en-IN');
  const idRef = document.getElementById('sc-cust-id')?.value.trim() || '-';
  const remarks = document.getElementById('sc-remarks')?.value.trim() || '-';
  const photoUrl = document.getElementById('sc-photo-url')?.value || '-';

  const recordPayload = {
    slNo: serialNo,
    dateTime: dateTime,
    name: custName,
    serviceName: serviceName,
    aadhaar: idRef,
    withdraw: totalAmt, 
    paying: paidAmt,
    pending: pendingAmt,
    remarks: remarks,
    photoUrl: photoUrl,
    type: 'Shop',
    isSynced: false,
    isEdited: false
  };

  if (scEditingCloudRecordKey) {
    try {
      let finalPhoto = photoUrl;
      if (photoUrl && photoUrl.startsWith('data:image')) {
        finalPhoto = await uploadBase64ToCloudinary(photoUrl);
      }
      const cloudPayload = { ...recordPayload, photoUrl: finalPhoto, isSynced: true, fbKey: scEditingCloudRecordKey };
      
      await fetch(`${SC_FIREBASE_DB_URL}/${scEditingCloudRecordKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudPayload)
      });
      showToastMessage("Cloud Shop Record updated!");
      scEditingCloudRecordKey = null;
      syncInScDatabase();
      openSection('sc-syncin');
    } catch (e) {
      console.error(e);
      showToastMessage("Failed to update Cloud Shop Record.");
    }
  } else if (scEditingRecordIndex > -1) {
    scBillingRecords[scEditingRecordIndex] = { ...scBillingRecords[scEditingRecordIndex], ...recordPayload, isSynced: false, isEdited: true };
    scEditingRecordIndex = -1;
    showToastMessage("Shop Record updated locally!");
    localStorage.setItem('sc_local_records', JSON.stringify(scBillingRecords));
    renderScReports();
    openSection('shop-menu');
  } else {
    scBillingRecords.unshift(recordPayload);
    scSlCounter++;
    localStorage.setItem('sc_sl_counter', scSlCounter);
    showToastMessage("Shop Record saved locally!");
    localStorage.setItem('sc_local_records', JSON.stringify(scBillingRecords));
    renderScReports();
    openSection('shop-menu');
  }

  resetScBillingForm();
  openEBillFromRecord(recordPayload);
}

function resetScBillingForm() {
  if (document.getElementById('sc-cust-name')) document.getElementById('sc-cust-name').value = '';
  if (document.getElementById('sc-service-name')) document.getElementById('sc-service-name').value = '';
  if (document.getElementById('sc-cust-id')) document.getElementById('sc-cust-id').value = '';
  if (document.getElementById('sc-total-amt')) document.getElementById('sc-total-amt').value = '';
  if (document.getElementById('sc-paid-amt')) document.getElementById('sc-paid-amt').value = '';
  if (document.getElementById('sc-pending-amt')) document.getElementById('sc-pending-amt').value = '';
  if (document.getElementById('sc-remarks')) document.getElementById('sc-remarks').value = '';
  if (document.getElementById('sc-photo-url')) document.getElementById('sc-photo-url').value = '';
  if (document.getElementById('sc-photo-input')) document.getElementById('sc-photo-input').value = '';

  const statusElem = document.getElementById('sc-upload-status');
  if (statusElem) statusElem.classList.add('hidden');

  scEditingRecordIndex = -1;
  scEditingCloudRecordKey = null;
  initScFormDefaults();
  calculateScPending();
}

function renderScReports() {
  const tbody = document.getElementById('sc-reports-list');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (scBillingRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-gray-500">No Shop records found locally.</td></tr>`;
    return;
  }

  scBillingRecords.forEach((record, index) => {
    let photoBtn = record.photoUrl && record.photoUrl !== '-' 
      ? `<button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="viewPhotoModal('${record.photoUrl}')">📷 View</button>` 
      : '-';

    let syncBadge = record.isSynced 
      ? `<span class="bg-emerald-100 text-emerald-800 text-xs px-2 py-1 rounded-full font-bold">Synced ✔️</span>` 
      : `<span class="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded-full font-bold">Pending ⏳</span>`;

    // Edit button enable ONLY IF pending amount > 0
    let hasPending = parseFloat(record.pending || 0) > 0;
    let actionBtnHTML = hasPending 
      ? `<button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="editScReportRecord(${index})">✏️ Edit</button>` 
      : `<span class="text-xs text-gray-400 italic">No Pending</span>`;

    tbody.innerHTML += `
      <tr>
        <td><strong>${record.slNo}</strong></td>
        <td><small>${record.dateTime}</small></td>
        <td>${record.name}</td>
        <td><small>${record.serviceName || '-'}</small></td>
        <td><small>${record.aadhaar}</small></td>
        <td>₹${parseFloat(record.withdraw || 0).toFixed(2)}</td>
        <td>₹${parseFloat(record.paying || 0).toFixed(2)}</td>
        <td class="font-bold ${(record.pending || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}">₹${parseFloat(record.pending || 0).toFixed(2)}</td>
        <td>${photoBtn}</td>
        <td>${syncBadge}</td>
        <td>${actionBtnHTML}</td>
      </tr>
    `;
  });
}

function editScReportRecord(index) {
  const record = scBillingRecords[index];
  scEditingRecordIndex = index;
  scEditingCloudRecordKey = null;

  openSection('sc-billing');

  if (document.getElementById('sc-serial-no')) document.getElementById('sc-serial-no').value = record.slNo;
  if (document.getElementById('sc-date-time')) document.getElementById('sc-date-time').value = record.dateTime;
  if (document.getElementById('sc-cust-name')) document.getElementById('sc-cust-name').value = record.name;
  if (document.getElementById('sc-service-name')) document.getElementById('sc-service-name').value = record.serviceName !== '-' ? record.serviceName : '';
  if (document.getElementById('sc-cust-id')) document.getElementById('sc-cust-id').value = record.aadhaar !== '-' ? record.aadhaar : '';
  if (document.getElementById('sc-total-amt')) document.getElementById('sc-total-amt').value = record.withdraw;
  if (document.getElementById('sc-paid-amt')) document.getElementById('sc-paid-amt').value = record.paying;
  if (document.getElementById('sc-remarks')) document.getElementById('sc-remarks').value = record.remarks !== '-' ? record.remarks : '';
  if (document.getElementById('sc-photo-url')) document.getElementById('sc-photo-url').value = record.photoUrl || '-';

  calculateScPending();
}

async function syncOutScData() {
  const unsynced = scBillingRecords.filter(r => !r.isSynced);
  if (unsynced.length === 0) {
    showToastMessage("All Shop records are already synced!");
    return;
  }

  showToastMessage("Syncing Shop records to Database...");

  for (let record of scBillingRecords) {
    if (!record.isSynced) {
      try {
        if (record.photoUrl && record.photoUrl.startsWith('data:image')) {
          record.photoUrl = await uploadBase64ToCloudinary(record.photoUrl);
        }

        const cloudPayload = { ...record, isSynced: true };

        let response;
        if (record.fbKey) {
          response = await fetch(`${SC_FIREBASE_DB_URL}/${record.fbKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudPayload)
          });
        } else {
          response = await fetch(`${SC_FIREBASE_DB_URL}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudPayload)
          });
          const resData = await response.json();
          if (resData && resData.name) record.fbKey = resData.name;
        }

        record.isSynced = true;
      } catch (err) {
        console.error("Shop Sync-out Error:", err);
      }
    }
  }

  localStorage.setItem('sc_local_records', JSON.stringify(scBillingRecords));
  renderScReports();
  showToastMessage("Shop Sync-Out Completed ✔️");
}

function filterScReports() {
  const query = document.getElementById('sc-report-search')?.value.toLowerCase() || '';
  const rows = document.querySelectorAll('#sc-reports-list tr');

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

async function syncInScDatabase() {
  const tbody = document.getElementById('sc-syncin-list');
  if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4">Fetching S.C records...</td></tr>`;

  try {
    const response = await fetch(`${SC_FIREBASE_DB_URL}.json`);
    const data = await response.json();

    scSyncedDatabaseRecords = [];

    if (data) {
      Object.keys(data).forEach(key => {
        scSyncedDatabaseRecords.unshift({
          fbKey: key,
          serviceName: data[key].serviceName || '-',
          photoUrl: data[key].photoUrl || '-',
          ...data[key]
        });
      });
    }

    renderScSyncInList();
    showToastMessage("Shop Cloud Data Fetched!");
  } catch (error) {
    console.error("Shop Firebase Fetch Error:", error);
    showToastMessage("Failed to fetch Shop data.");
    renderScSyncInList();
  }
}

function renderScSyncInList() {
  const tbody = document.getElementById('sc-syncin-list');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (scSyncedDatabaseRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-gray-500">Click 'Fetch Database' to view cloud records.</td></tr>`;
    return;
  }

  scSyncedDatabaseRecords.forEach((record, index) => {
    let photoBtn = record.photoUrl && record.photoUrl !== '-' 
      ? `<button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="viewPhotoModal('${record.photoUrl}')">📷 View</button>` 
      : '-';

    tbody.innerHTML += `
      <tr>
        <td><strong>${record.slNo}</strong></td>
        <td><small>${record.dateTime}</small></td>
        <td>${record.name}</td>
        <td><small>${record.serviceName || '-'}</small></td>
        <td><small>${record.aadhaar}</small></td>
        <td>₹${parseFloat(record.withdraw || 0).toFixed(2)}</td>
        <td>₹${parseFloat(record.paying || 0).toFixed(2)}</td>
        <td class="font-bold ${(record.pending || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}">₹${parseFloat(record.pending || 0).toFixed(2)}</td>
        <td>${photoBtn}</td>
        <td>
          <div class="flex gap-1">
            <button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="editScCloudRecord(${index})">✏️ Edit</button>
            <button class="t-btn t-btn-accent px-2 py-1 text-xs" onclick="openScEBillModal(${index})">🧾 Bill</button>
            <button class="t-btn t-btn-warning px-2 py-1 text-xs bg-red-600" onclick="deleteScSyncRecord(${index})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  });
}

function editScCloudRecord(index) {
  const record = scSyncedDatabaseRecords[index];
  scEditingCloudRecordKey = record.fbKey;
  scEditingRecordIndex = -1;

  openSection('sc-billing');

  if (document.getElementById('sc-serial-no')) document.getElementById('sc-serial-no').value = record.slNo;
  if (document.getElementById('sc-date-time')) document.getElementById('sc-date-time').value = record.dateTime;
  if (document.getElementById('sc-cust-name')) document.getElementById('sc-cust-name').value = record.name;
  if (document.getElementById('sc-service-name')) document.getElementById('sc-service-name').value = record.serviceName !== '-' ? record.serviceName : '';
  if (document.getElementById('sc-cust-id')) document.getElementById('sc-cust-id').value = record.aadhaar !== '-' ? record.aadhaar : '';
  if (document.getElementById('sc-total-amt')) document.getElementById('sc-total-amt').value = record.withdraw;
  if (document.getElementById('sc-paid-amt')) document.getElementById('sc-paid-amt').value = record.paying;
  if (document.getElementById('sc-remarks')) document.getElementById('sc-remarks').value = record.remarks !== '-' ? record.remarks : '';
  if (document.getElementById('sc-photo-url')) document.getElementById('sc-photo-url').value = record.photoUrl || '-';

  calculateScPending();
}

function openScEBillModal(index) {
  const record = scSyncedDatabaseRecords[index];
  openEBillFromRecord(record);
}

async function deleteScSyncRecord(index) {
  if (confirm("Delete this Shop record permanently from cloud?")) {
    const record = scSyncedDatabaseRecords[index];

    if (record && record.fbKey) {
      try {
        await fetch(`${SC_FIREBASE_DB_URL}/${record.fbKey}.json`, { method: 'DELETE' });
        showToastMessage("Shop Record deleted.");
      } catch (err) {
        console.error("Shop Delete Error:", err);
      }
    }

    scSyncedDatabaseRecords.splice(index, 1);
    scBillingRecords = scBillingRecords.filter(r => r.fbKey !== record.fbKey);
    localStorage.setItem('sc_local_records', JSON.stringify(scBillingRecords));
    renderScSyncInList();
    renderScReports();
  }
}

function filterScSyncData() {
  const query = document.getElementById('sc-sync-search')?.value.toLowerCase() || '';
  const rows = document.querySelectorAll('#sc-syncin-list tr');

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

// ----------------------------------------------------
// 3. OCR CAMERA SCANNER LOGIC
// ----------------------------------------------------

function validateAadhaarInput(input) {
  input.value = input.value.replace(/[^0-9]/g, '').slice(0, 12);
}

async function openCameraModal(targetInputId) {
  currentOcrTargetId = targetInputId;
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
      const inputField = document.getElementById(currentOcrTargetId);
      if (inputField) {
        inputField.value = extractedNumber;
      }
      showToastMessage("Number Scanned & Filled!");
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
// 4. E-BILL MODAL, DOWNLOAD & PRINT
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

  const serviceRow = document.getElementById('e-service-row');
  const serviceElem = document.getElementById('e-service');
  if (record.serviceName && record.serviceName !== '-') {
    if (serviceRow) serviceRow.classList.remove('hidden');
    if (serviceElem) serviceElem.innerText = record.serviceName;
  } else {
    if (serviceRow) serviceRow.classList.add('hidden');
  }

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

async function downloadEBillReceipt(format = 'jpg') {
  const element = document.getElementById('ebill-printable');
  const slNo = document.getElementById('e-sl')?.innerText || 'Receipt';

  if (!element) return;
  showToastMessage("Downloading...");

  try {
    const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });

    if (format.toLowerCase() === 'pdf' && window.jspdf) {
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
      const mimeType = format.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
      const fileExt = format.toLowerCase() === 'png' ? 'png' : 'jpg';

      canvas.toBlob((blob) => {
        if (blob) {
          executeHopwebDirectDownload(blob, `Invoice_${slNo}.${fileExt}`, mimeType);
          showToastMessage(`${fileExt.toUpperCase()} Downloaded!`);
        }
      }, mimeType, 0.98);
    }
  } catch (err) {
    console.error("Direct download error:", err);
    window.print();
  }
}

function executeHopwebDirectDownload(blobOrData, filename, mimeType) {
  let blob = (blobOrData instanceof Blob) ? blobOrData : new Blob([blobOrData], { type: mimeType });
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
    `ID / Ref   : ${aadhaar}\n` +
    "--------------------------------\n" +
    `Amount     : Rs. ${withdraw}\n` +
    `Paid/Recv  : Rs. ${paying}\n` +
    `Pending    : Rs. ${pending}\n` +
    `Remarks    : ${remarks}\n` +
    "--------------------------------\n\n" +
    "       Authorised Signatory\n" +
    "--------------------------------\n" +
    "Thank You For Business!\n\n\n";

  try {
    showToastMessage("Opening Thermal Printer...");
    const intentUrl = `intent:${encodeURIComponent(rawReceiptText)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    window.location.href = intentUrl;
  } catch (err) {
    console.error("Thermal Print Error:", err);
  }
}
