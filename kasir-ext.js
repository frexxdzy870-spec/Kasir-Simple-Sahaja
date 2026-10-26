// kasir-ext.js — dimuat SETELAH script utama di index.html. Tampilan asli tidak diubah.
(function () {
  const sb = supabaseClient;
  const $ = id => document.getElementById(id);
  const wibDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  let expenses = [];
  const inp = 'w-full border-2 border-amber-200 rounded-xl p-3 bg-amber-50/30 focus:outline-none focus:border-[#b30b0b] font-medium transition';
  const lbl = 'block text-xs font-bold uppercase tracking-wider text-amber-900 mb-1';

  // Perbaikan: ID produk ganda (ao5, mk8) + bug closeSuccessPopup
  const seen = {};
  hardcodedProducts.forEach(p => { if (seen[p.id]) p.id += 'b'; seen[p.id] = 1; });
  window.closeSuccessPopup = function () {
    const pop = $('success-popup');
    pop.firstElementChild.classList.add('scale-95'); pop.classList.add('hidden');
    if (!$('tab-rekap').classList.contains('hidden')) { loadShiftReport(); loadTransactionHistory(); }
  };

  // ===== Login: nama + shift + PIN =====
  const loginBtn = document.querySelector('#login-screen button');
  loginBtn.insertAdjacentHTML('beforebegin',
    `<div><label class="${lbl}">Shift</label><select id="shift-type" class="${inp}"><option value="pagi">Pagi</option><option value="malam">Malam</option></select></div>
     <div><label class="${lbl}">PIN</label><input type="password" id="shift-pin" class="${inp}" placeholder="PIN"></div>`);
  $('shift-username').placeholder = 'Contoh: Fer';
  $('shift-username').previousElementSibling.innerText = 'Nama Karyawan';

  window.startShift = async function () {
    const name = $('shift-username').value.trim(), pin = $('shift-pin').value, st = $('shift-type').value;
    if (!name || !pin) return alert('Nama dan PIN wajib diisi!');
    try {
      const { data: emp, error: empErr } = await sb.from('employees').select('id,name,role').ilike('name', name).eq('pin', pin.trim()).neq('active', false).limit(1);
      if (empErr) return alert('Gagal cek karyawan (bukan salah PIN): ' + empErr.message);
      if (!emp || !emp.length) return alert('Nama atau PIN salah (atau data karyawan tidak terbaca, cek RLS/tabel employees)');
      const e = emp[0];
      if (e.role === 'admin') { sessionStorage.setItem('admin', '1'); return (location.href = 'admin.html'); }
      const label = `${e.name} ${st === 'pagi' ? 'Pagi' : 'Malam'}`;
      const { data, error } = await sb.from('shifts').insert([{ cashier_name: label, initial_cash: 0, status: 'open', employee_id: e.id, shift_type: st }]).select('id');
      if (error) return alert('Gagal Simpan Shift: ' + error.message);
      // Absen hadir otomatis saat login
      const { error: abErr } = await sb.from('attendance').upsert({ employee_id: e.id, work_date: wibDate(), shift_type: st, status: 'hadir' }, { onConflict: 'employee_id,work_date,shift_type' });
      if (abErr) alert('Absen gagal tersimpan: ' + abErr.message);
      localStorage.setItem('currentShiftId', data[0].id);
      localStorage.setItem('currentCashier', label);
      location.reload();
    } catch (err) { alert('Sistem Crash: ' + err.message); }
  };

  // ===== Pengeluaran rinci (dipasang di bawah kotak pengeluaran yang sudah ada) =====
  const box = $('input-pengeluaran').closest('div.bg-amber-50');
  $('input-pengeluaran').readOnly = true; // jadi total otomatis dari rincian
  const f = 'border border-amber-200 bg-white rounded-xl p-2 text-sm font-bold focus:outline-none focus:border-[#b30b0b]';
  box.insertAdjacentHTML('afterend',
    `<div class="bg-amber-50 p-4 rounded-2xl border border-amber-200 space-y-2">
      <span class="text-xs font-bold text-amber-900 uppercase tracking-wide">Rincian Pengeluaran Harian</span>
      <div class="grid grid-cols-12 gap-2">
        <input id="ex-name" class="${f} col-span-12 sm:col-span-5" placeholder="Nama barang">
        <input id="ex-qty" type="number" value="1" class="${f} col-span-3 sm:col-span-2" placeholder="Jml">
        <input id="ex-price" type="number" class="${f} col-span-5 sm:col-span-3" placeholder="Harga (total)">
        <select id="ex-pay" class="${f} col-span-4 sm:col-span-2"><option value="cash">Cash</option><option value="qris">QRIS</option></select>
      </div>
      <button onclick="addExpense()" class="w-full bg-[#b30b0b] hover:bg-[#a00606] text-[#fef2cc] font-black py-2 rounded-xl text-xs uppercase tracking-wider">+ Tambah Pengeluaran</button>
      <div id="ex-list" class="space-y-1 text-xs"></div>
    </div>`);

  async function loadExpenses() {
    if (!currentShiftId) return;
    const { data } = await sb.from('expenses').select('*').eq('shift_id', currentShiftId).order('created_at');
    expenses = data || [];
    $('ex-list').innerHTML = expenses.map(e => `<div class="flex justify-between items-center bg-white rounded-lg px-2 py-1 border border-amber-100">
      <span class="font-bold">${e.item_name} x${e.qty} <span class="text-gray-400">(${e.pay})</span></span>
      <span class="font-black">Rp ${e.price.toLocaleString('id-ID')} <button onclick="delExpense('${e.id}')" class="text-red-500 ml-2">✕</button></span></div>`).join('');
    $('input-pengeluaran').value = expenses.reduce((a, e) => a + e.price, 0);
    updateReportPreview();
  }
  window.addExpense = async function () {
    const item_name = $('ex-name').value.trim(), price = parseInt($('ex-price').value), qty = parseInt($('ex-qty').value) || 1;
    if (!item_name || !price) return alert('Isi nama barang dan harga!');
    const { error } = await sb.from('expenses').insert([{ shift_id: currentShiftId, item_name, qty, price, pay: $('ex-pay').value }]);
    if (error) return alert('Gagal simpan pengeluaran: ' + error.message);
    $('ex-name').value = ''; $('ex-price').value = ''; $('ex-qty').value = 1;
    loadExpenses();
  };
  window.delExpense = async function (id) { await sb.from('expenses').delete().eq('id', id); loadExpenses(); };

  // Teks laporan: sisipkan rincian pengeluaran di bawah baris "Pengeluaran"
  const _urp = updateReportPreview;
  window.updateReportPreview = function () {
    _urp();
    if (!expenses.length) return;
    const el = $('wa-text-preview');
    const lines = expenses.map(e => `- ${e.item_name}${e.qty > 1 ? ' x' + e.qty : ''} : Rp ${e.price.toLocaleString('id-ID')}${e.pay === 'qris' ? ' (QRIS)' : ''}`).join('\n');
    el.innerText = el.innerText.replace(/(\*Pengeluaran[^\n]*\n)/, (m) => m + lines + '\n');
  };
  const _lsr = loadShiftReport;
  window.loadShiftReport = async function () { await loadExpenses(); await _lsr(); };

  // Kirim ke WA tetap jalan; salinan laporan otomatis masuk ke admin
  const _stw = sendToWhatsApp;
  window.sendToWhatsApp = async function () {
    _stw();
    try {
      const exp = expenses.reduce((a, e) => a + e.price, 0);
      await sb.from('reports').delete().eq('shift_id', currentShiftId);
      await sb.from('reports').insert({ shift_id: currentShiftId, cashier_name: currentCashier, report_text: $('wa-text-preview').innerText, revenue: reportData.revenue, qris: reportData.qris, cash: reportData.cash, expense_total: exp });
    } catch (e) { console.error(e); }
  };

  // Stok berkurang otomatis setelah transaksi sukses
  const _st = submitTransaction;
  window.submitTransaction = async function () {
    const snap = Object.values(cart).map(i => ({ name: i.name, qty: i.qty }));
    await _st();
    if (snap.length && Object.keys(cart).length === 0) {
      for (const it of snap) await sb.rpc('decrement_stock', { p_name: it.name, p_qty: it.qty });
    }
  };
})();
