import { jsPDF } from 'jspdf';
import { dbQuery } from './api';

const HSN_MAP: Record<number, string> = { 28: '85287300', 18: '84181000', 12: '85094010', 5: '84151010' };

export async function generatePDF(invoice: any, customer: any, items: any[]) {
  // Load dynamic business profile settings
  let business = {
    name: "Saral",
    address: 'N/A Santi Nagar main Road , 2n0 Dabgram Siliguri',
    phone: '9046726365',
    gstin: '19ACRPD0341C1Z0',
    email: 'joydeep.dey1971@gmail.com',
    state: '19-West Bengal',
    logo_base64: '',
    bank_details: '',
    upi_id: '',
  };

  try {
    const res = await dbQuery('SELECT * FROM business_profile WHERE id = 1');
    if (res && res.length > 0) {
      business = { ...business, ...res[0] };
    }
  } catch (err) {
    console.error('Failed to load business profile for PDF:', err);
  }
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth(); // 210mm
  const L = 10, R = pageW - 10;
  const W = R - L; // 190mm usable

  // ── Utility: format a number as ₹ with 2 decimal places ──
  function rs(n: number) {
    const abs = Math.abs(n || 0);
    const str = abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '- Rs.' : 'Rs.') + ' ' + str;
  }

  // ── Helper: write text clipped to a cell, with optional border ──
  function cellText(x: number, y: number, w: number, h: number, text: any, opts: any = {}) {
    if (opts.border !== false) doc.rect(x, y, w, h);
    if (text === null || text === undefined || text === '') return;
    const align = opts.align || 'left';
    const size = opts.size || 8;
    const bold = opts.bold || false;
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const color = (opts.color || [0, 0, 0]) as [number, number, number];
    doc.setTextColor(color[0], color[1], color[2]);
    const pad = 1.5;
    const tx = align === 'right' ? x + w - pad
             : align === 'center' ? x + w / 2
             : x + pad;
    const ty = y + h / 2 + size * 0.18; // vertical centre
    doc.text(String(text), tx, ty, { align, maxWidth: w - pad * 2 });
  }

  // ── Calculations ──────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
  const totalGst = items.reduce((s, i) => s + (i.gst_amount || 0), 0);
  const rawTotal = subtotal + totalGst;
  const rounded = Math.round(rawTotal);
  const roundOff = +(rounded - rawTotal).toFixed(2);
  const finalTotal = rounded;

  const isPaid = invoice.status === 'paid';
  const pm = invoice.payment_mode || '';
  const dpVal = (pm === 'Bajaj Finance' || pm === 'Other Finance Partner') ? (invoice.down_payment || 0) : 0;
  const received = isPaid ? (pm === 'Bajaj Finance' || pm === 'Other Finance Partner' ? dpVal : finalTotal) : 0;
  const balance = isPaid ? (pm === 'Bajaj Finance' || pm === 'Other Finance Partner' ? finalTotal - dpVal : 0) : finalTotal;

  // HSN grouping for CGST/SGST table
  const hsnGroups: Record<string, any> = {};
  items.forEach(item => {
    const hsn = item.hsn_code || HSN_MAP[item.gst_percentage] || '85094010';
    if (!hsnGroups[hsn]) {
      hsnGroups[hsn] = { hsn, rate: item.gst_percentage || 18, taxable: 0, cgst: 0, sgst: 0 };
    }
    hsnGroups[hsn].taxable += (item.price || 0) * (item.quantity || 1);
    hsnGroups[hsn].cgst += (item.gst_amount || 0) / 2;
    hsnGroups[hsn].sgst += (item.gst_amount || 0) / 2;
  });
  const hsnRows = Object.values(hsnGroups);

  // ── Amount In Words helper ───────────────────────────────────────────
  function amountInWords(amount: number) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function toWords(n: number): string {
      if (n === 0) return '';
      if (n < 20) return ones[n] + ' ';
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' ';
      if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred ' + toWords(n % 100);
      if (n < 100000) return toWords(Math.floor(n / 1000)) + 'Thousand ' + toWords(n % 1000);
      if (n < 10000000) return toWords(Math.floor(n / 100000)) + 'Lakh ' + toWords(n % 100000);
      return toWords(Math.floor(n / 10000000)) + 'Crore ' + toWords(n % 10000000);
    }
    const roundedAmt = Math.round(amount);
    const paise = Math.round((amount - roundedAmt) * 100);
    let words = toWords(roundedAmt).trim() + ' Rupees';
    if (paise > 0) words += ' and ' + toWords(paise).trim() + ' Paise';
    return words + ' only';
  }

  // ── Layout constants ──────────────────────────────────────────────────────
  let y = 10;
  const ROW = 7; // standard row height
  const BIG = 8; // taller rows

  // ── 1. Title bar ──────────────────────────────────────────────────────────
  cellText(L, y, W, ROW, invoice.type || 'Tax Invoice', { align: 'center', bold: true, size: 11 });
  y += ROW;

  // ── 2. Business info (left 55%) | Invoice meta (right 45%) ───────────────
  const BLW = W * 0.55;
  const MRW = W * 0.45;
  const MRX = L + BLW;
  const BH = ROW * 4;

  doc.rect(L, y, BLW, BH);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(business.name, L + 2, y + 6);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  const addrLines = doc.splitTextToSize(business.address, BLW - 4);
  let ty2 = y + 11;
  addrLines.forEach((ln: string) => { doc.text(ln, L + 2, ty2); ty2 += 4; });
  doc.text('Phone no.: ' + business.phone, L + 2, ty2); ty2 += 4;
  doc.text('Email: ' + business.email, L + 2, ty2); ty2 += 4;
  doc.text('GSTIN: ' + business.gstin, L + 2, ty2); ty2 += 4;
  doc.text('State: ' + business.state, L + 2, ty2);

  // Render logo if base64 data is present
  if (business.logo_base64) {
    try {
      doc.addImage(business.logo_base64, 'PNG', L + BLW - 34, y + 2, 32, 14);
    } catch (err) {
      console.error('Failed to render company logo on PDF:', err);
    }
  }

  // Right meta
  cellText(MRX, y, MRW * 0.5, ROW, 'Invoice No.', { size: 8 });
  cellText(MRX + MRW * 0.5, y, MRW * 0.5, ROW, 'Date', { size: 8 });
  cellText(MRX, y + ROW, MRW * 0.5, ROW, invoice.invoice_number, { bold: true, size: 9 });
  cellText(MRX + MRW * 0.5, y + ROW, MRW * 0.5, ROW, invoice.date, { bold: true, size: 9 });
  cellText(MRX, y + ROW * 2, MRW, ROW, 'Place of supply', { size: 8 });
  cellText(MRX, y + ROW * 3, MRW, ROW, customer.state || business.state, { bold: true, size: 9 });

  y += BH;

  // ── 3. Bill To label + customer block ────────────────────────────────────
  cellText(L, y, W, ROW - 2, 'Bill To', { size: 8, color: [80, 80, 80] });
  y += ROW - 2;

  const billLines = [
    customer.name || '—',
    customer.address || '',
    customer.mobile ? 'Ph: ' + customer.mobile : '',
    customer.gstin ? 'GSTIN: ' + customer.gstin : '',
  ].filter(Boolean);
  const billH = Math.max(14, billLines.length * 5 + 4);
  doc.rect(L, y, W, billH);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(billLines[0], L + 2, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  billLines.slice(1).forEach((ln, i) => doc.text(ln, L + 2, y + 10 + i * 5));
  y += billH;

  // ── 4. Items table ────────────────────────────────────────────────────────
  const C = {
    no: { x: L, w: 6 },
    name: { x: L + 6, w: 55 },
    hsn: { x: L + 61, w: 22 },
    qty: { x: L + 83, w: 14 },
    unit: { x: L + 97, w: 13 },
    price: { x: L + 110, w: 28 },
    gst: { x: L + 138, w: 25 },
    amount: { x: L + 163, w: R - L - 163 },
  };
  const HDR = ROW;

  doc.setFillColor(240, 240, 240);
  Object.values(C).forEach(c => doc.rect(c.x, y, c.w, HDR, 'FD'));
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  
  const headers = [
    { key: 'no', label: '#' },
    { key: 'name', label: 'Item name' },
    { key: 'hsn', label: 'HSN/ SAC' },
    { key: 'qty', label: 'Quantity' },
    { key: 'unit', label: 'Unit' },
    { key: 'price', label: 'Price/ Unit' },
    { key: 'gst', label: 'GST' },
    { key: 'amount', label: 'Amount' }
  ];

  headers.forEach(h => {
    const c = (C as any)[h.key];
    doc.text(h.label, c.x + c.w / 2, y + HDR / 2 + 1.2, { align: 'center' });
  });
  y += HDR;

  // Item rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  items.forEach((item, idx) => {
    if (y + BIG > 255) { doc.addPage(); y = 15; }
    const hsn = item.hsn_code || HSN_MAP[item.gst_percentage] || '85094010';
    const basePrice = +(item.price || 0);
    const gstAmt = +(item.gst_amount || 0);
    const rowTotal = +(item.total || (basePrice * item.quantity + gstAmt));
    const cy = y + BIG / 2 + 1.2;

    Object.values(C).forEach(c => doc.rect(c.x, y, c.w, BIG));
    doc.setTextColor(0, 0, 0);

    doc.text(String(idx + 1), C.no.x + C.no.w / 2, cy, { align: 'center' });

    doc.setFontSize(7);
    const nameLines = doc.splitTextToSize(item.name, C.name.w - 2);
    doc.text(nameLines, C.name.x + 1.5, y + 3);
    doc.setFontSize(7.5);

    doc.text(String(hsn), C.hsn.x + C.hsn.w / 2, cy, { align: 'center' });
    doc.text(String(item.quantity || 1), C.qty.x + C.qty.w - 1.5, cy, { align: 'right' });
    doc.text(item.unit || 'Nos', C.unit.x + C.unit.w / 2, cy, { align: 'center' });
    doc.text(rs(basePrice), C.price.x + C.price.w - 1.5, cy, { align: 'right' });

    const gstLabel = rs(gstAmt) + ' (' + (item.gst_percentage || 0) + '%)';
    doc.setFontSize(6.5);
    doc.text(gstLabel, C.gst.x + C.gst.w / 2, cy, { align: 'center', maxWidth: C.gst.w - 2 });
    doc.setFontSize(7.5);

    doc.text(rs(rowTotal), C.amount.x + C.amount.w - 1.5, cy, { align: 'right' });

    y += BIG;
  });

  // Total row
  const tH = ROW;
  doc.setFillColor(240, 240, 240);
  doc.rect(C.no.x, y, C.no.w + C.name.w + C.hsn.w + C.qty.w + C.unit.w, tH, 'FD');
  doc.rect(C.price.x, y, C.price.w + C.gst.w, tH, 'FD');
  doc.rect(C.amount.x, y, C.amount.w, tH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('Total', C.no.x + 2, y + tH / 2 + 1.5);
  
  const totalQty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  doc.text(String(totalQty), C.price.x + C.price.w + C.gst.w - 1.5, y + tH / 2 + 1.5, { align: 'right' });
  doc.text(rs(rawTotal), C.amount.x + C.amount.w - 1.5, y + tH / 2 + 1.5, { align: 'right' });
  y += tH;

  // ── 5. Amount in Words | Amounts summary ───────────────────────────────
  const amtLW = W * 0.5, amtRW = W * 0.5, amtRX = L + amtLW;
  const amtRowH = ROW - 1;
  const amtRows = [
    { lbl: 'Amounts', val: '', bold: true },
    { lbl: 'Sub Total', val: rs(subtotal), bold: false },
    { lbl: 'Round off', val: (roundOff >= 0 ? '+ ' : '') + rs(roundOff), bold: false },
    { lbl: 'Total', val: rs(finalTotal), bold: true },
    { lbl: 'Received', val: rs(received), bold: false },
    { lbl: 'Balance', val: rs(balance), bold: false },
  ];
  const amtBlockH = amtRows.length * amtRowH;

  doc.rect(L, y, amtLW, amtBlockH);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Invoice Amount in Words', L + 2, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  const wordLines = doc.splitTextToSize(amountInWords(finalTotal), amtLW - 4);
  doc.text(wordLines, L + 2, y + 10);

  if (pm === 'Bajaj Finance' || pm === 'Other Finance Partner') {
    const emiVal = invoice.emi_amount || 0;
    const finCompany = pm === 'Bajaj Finance' ? 'Bajaj Finance' : (invoice.finance_company || 'Finance Partner');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Finance Details:', L + 2, y + 19);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(`Payment Mode: ${finCompany}`, L + 2, y + 23);
    doc.text(`Down Payment: ${rs(dpVal)}`, L + 2, y + 27);
    doc.text(`EMI: ${rs(emiVal)} / Month`, L + 2, y + 31);
  }

  amtRows.forEach((row, i) => {
    const ry = y + i * amtRowH;
    doc.rect(amtRX, ry, amtRW, amtRowH);
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(row.lbl, amtRX + 2, ry + amtRowH / 2 + 1.4);
    if (row.val) doc.text(row.val, amtRX + amtRW - 1.5, ry + amtRowH / 2 + 1.4, { align: 'right' });
  });
  y += amtBlockH;

  // ── 6. CGST / SGST summary table ─────────────────────────────────────────
  const G = {
    hsn: { x: L, w: 30 },
    tax: { x: L + 30, w: 32 },
    cr: { x: L + 62, w: 18 },
    ca: { x: L + 80, w: 28 },
    sr: { x: L + 108, w: 18 },
    sa: { x: L + 126, w: 28 },
    tot: { x: L + 154, w: R - L - 154 },
  };
  const GH = ROW - 1;

  doc.setFillColor(240, 240, 240);
  doc.rect(G.hsn.x, y, G.hsn.w, GH * 2, 'FD');
  doc.rect(G.tax.x, y, G.tax.w, GH * 2, 'FD');
  doc.rect(G.cr.x, y, G.cr.w + G.ca.w, GH, 'FD');
  doc.rect(G.sr.x, y, G.sr.w + G.sa.w, GH, 'FD');
  doc.rect(G.tot.x, y, G.tot.w, GH * 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text('HSN/ SAC', G.hsn.x + G.hsn.w / 2, y + GH / 2 + 1, { align: 'center' });
  doc.text('Taxable amount', G.tax.x + G.tax.w / 2, y + GH / 2 + 1, { align: 'center' });
  doc.text('CGST', G.cr.x + (G.cr.w + G.ca.w) / 2, y + GH / 2 + 1, { align: 'center' });
  doc.text('SGST', G.sr.x + (G.sr.w + G.sa.w) / 2, y + GH / 2 + 1, { align: 'center' });
  doc.text('Total Tax Amount', G.tot.x + G.tot.w / 2, y + GH / 2 + 1, { align: 'center' });

  doc.setFillColor(240, 240, 240);
  [G.cr, G.ca, G.sr, G.sa].forEach((c, i) => {
    doc.rect(c.x, y + GH, c.w, GH, 'FD');
    doc.text(i % 2 === 0 ? 'Rate' : 'Amount', c.x + c.w / 2, y + GH + GH / 2 + 1, { align: 'center' });
  });
  y += GH * 2;

  // Data rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  hsnRows.forEach(row => {
    const halfRate = (row.rate / 2);
    const rateStr = halfRate + '%';
    [G.hsn, G.tax, G.cr, G.ca, G.sr, G.sa, G.tot].forEach(c => doc.rect(c.x, y, c.w, GH));
    const cy2 = y + GH / 2 + 1.2;
    doc.setTextColor(0, 0, 0);
    doc.text(row.hsn, G.hsn.x + G.hsn.w / 2, cy2, { align: 'center' });
    doc.text(rs(row.taxable), G.tax.x + G.tax.w - 1.5, cy2, { align: 'right' });
    doc.text(rateStr, G.cr.x + G.cr.w / 2, cy2, { align: 'center' });
    doc.text(rs(row.cgst), G.ca.x + G.ca.w - 1.5, cy2, { align: 'right' });
    doc.text(rateStr, G.sr.x + G.sr.w / 2, cy2, { align: 'center' });
    doc.text(rs(row.sgst), G.sa.x + G.sa.w - 1.5, cy2, { align: 'right' });
    doc.text(rs(row.cgst + row.sgst), G.tot.x + G.tot.w - 1.5, cy2, { align: 'right' });
    y += GH;
  });

  // Totals row
  doc.setFillColor(240, 240, 240);
  [G.hsn, G.tax, G.cr, G.ca, G.sr, G.sa, G.tot].forEach(c => doc.rect(c.x, y, c.w, GH, 'FD'));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  const cy4 = y + GH / 2 + 1.2;
  const ttx = hsnRows.reduce((s, r) => s + r.taxable, 0);
  const tcg = hsnRows.reduce((s, r) => s + r.cgst, 0);
  const tsg = hsnRows.reduce((s, r) => s + r.sgst, 0);
  doc.text('Total', G.hsn.x + 2, cy4);
  doc.text(rs(ttx), G.tax.x + G.tax.w - 1.5, cy4, { align: 'right' });
  doc.text(rs(tcg), G.ca.x + G.ca.w - 1.5, cy4, { align: 'right' });
  doc.text(rs(tsg), G.sa.x + G.sa.w - 1.5, cy4, { align: 'right' });
  doc.text(rs(tcg + tsg), G.tot.x + G.tot.w - 1.5, cy4, { align: 'right' });
  y += GH;

  // ── 7. Terms & Conditions | Authorized Signatory ───────────────────────
  const footH = 44;
  const termW = W * 0.62, sigW = W * 0.38, sigX = L + termW;
  doc.rect(L, y, termW, footH);
  doc.rect(sigX, y, sigW, footH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('Terms and conditions', L + 2, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(30, 30, 30);
  
  const jurisdiction = business.state ? business.state.split('-')[1] || business.state : 'West Bengal';
  
  const terms = [
    'Thanks for doing business with us!',
    '1. Goods once sold will not be taken back or exchanged.',
    '2. Please check the product at the time of delivery.',
    '3. All warranties are as per the manufacturer\'s terms and service centers.',
    '4. Invoice must be preserved for warranty claims.',
    '5. Payment once made is non-refundable.',
    '6. Prices are inclusive of GST unless mentioned otherwise.',
    '7. Delivery and installation (if applicable) are extra.',
    `8. Subject to ${jurisdiction} jurisdiction.`
  ];

  if (business.bank_details) {
    terms.push(`Bank: ${business.bank_details}`);
  }
  if (business.upi_id) {
    terms.push(`UPI: ${business.upi_id}`);
  }

  // Adjust line spacing dynamically to fit terms
  const spacing = terms.length > 9 ? 3.3 : 3.8;
  terms.forEach((ln, i) => doc.text(ln, L + 2, y + 9 + i * spacing));

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('For : ' + business.name, sigX + 4, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Authorized Signatory', sigX + sigW / 2, y + footH - 4, { align: 'center' });

  doc.save(`${invoice.invoice_number}.pdf`);
}
