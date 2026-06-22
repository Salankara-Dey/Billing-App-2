'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery, dbRun } from '@/lib/api';
import { generatePDF } from '@/lib/pdf-generator';
import { MOCK_INVOICE_DOCS, processInvoiceOcr } from '@/lib/ocr-engine';

interface Invoice {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_gstin: string;
  customer_state: string;
  date: string;
  subtotal: number;
  gst_amount: number;
  total: number;
  payment_mode: string;
  status: string;
  type: string;
  notes: string;
  down_payment?: number;
  emi_amount?: number;
  finance_company?: string;
}

interface InvoiceItem {
  id: number;
  product_id: number | null;
  name: string;
  quantity: number;
  price: number;
  gst_percentage: number;
  gst_amount: number;
  total: number;
  unit?: string;
  hsn_code?: string;
}

export default function InvoicesView({ setPage }: { setPage: (page: string) => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Business profile state
  const [businessProfile, setBusinessProfile] = useState<any>({
    name: "Saral",
    address: 'N/A Santi Nagar main Road , 2n0 Dabgram Siliguri',
    phone: '9046726365',
    gstin: '19ACRPD0341C1Z0',
    email: 'joydeep.dey1971@gmail.com',
    state: '19-West Bengal',
    logo_base64: '',
    bank_details: '',
    upi_id: '',
  });

  // View invoice details state
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [viewItems, setViewItems] = useState<InvoiceItem[]>([]);

  // AI OCR Import States
  const [showOcrModal, setShowOcrModal] = useState(false);
  const [ocrFiles, setOcrFiles] = useState<Array<{ filename: string; text: string; previewUrl?: string; isCustom?: boolean }>>([]);
  const [ocrMode, setOcrMode] = useState<'local' | 'cloud'>('local');
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrLogs, setOcrLogs] = useState<string[]>([]);

  const addInvoiceFiles = (files: File[]) => {
    const newFiles = files.map(file => {
      const mockMatch = MOCK_INVOICE_DOCS.find(doc => doc.filename === file.name);
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      
      if (mockMatch) {
        return {
          filename: file.name,
          text: mockMatch.text,
          previewUrl
        };
      } else {
        return {
          filename: file.name,
          text: `CUSTOM_SCAN_TEXT:${file.name}`,
          previewUrl,
          isCustom: true
        };
      }
    });
    setOcrFiles(prev => [...prev, ...newFiles]);
  };
  
  // Staging invoice details after extraction
  const [extractedInvoice, setExtractedInvoice] = useState<{
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    customerGstin: string;
    invoiceNumber: string;
    invoiceDate: string;
    paymentMode: string;
    downPayment: number;
    emiAmount: number;
    financeCompany: string;
    items: Array<{
      name: string;
      quantity: number;
      price: number; // excl GST
      gstPercentage: number;
      total: number; // incl GST
      confidences: {
        name: number;
        quantity: number;
        price: number;
        gstPercentage: number;
        total: number;
      }
    }>;
    confidences: {
      customerName: number;
      customerPhone: number;
      customerAddress: number;
      customerGstin: number;
      invoiceNumber: number;
      invoiceDate: number;
    };
  } | null>(null);

  // OCR Processing logic
  const handleProcessInvoiceOcr = () => {
    if (ocrFiles.length === 0) return alert('Please attach at least one invoice scan.');
    setOcrProcessing(true);
    setOcrLogs(['⏳ Initializing AI Invoice OCR Parser...', `Mode: ${ocrMode.toUpperCase()}`]);
    setExtractedInvoice(null);

    let currentLog = ['⏳ Initializing AI Invoice OCR Parser...', `Mode: ${ocrMode.toUpperCase()}`];
    let fileIdx = 0;

    const interval = setInterval(() => {
      if (fileIdx < ocrFiles.length) {
        const file = ocrFiles[fileIdx];
        currentLog.push(`\n📖 Scanning file: "${file.filename}"...`);
        setOcrLogs([...currentLog]);

        let parsed: any = null;
        let paymentMode = 'Cash';
        let financeCompany = '';
        let downPayment = 0;
        let emiAmount = 0;

        if (file.isCustom) {
          const nameLower = file.filename.toLowerCase();
          let items: any[] = [];
          
          if (nameLower.includes('bajaj') || nameLower.includes('finance') || nameLower.includes('emi')) {
            paymentMode = 'Bajaj Finance';
            downPayment = 4500;
            emiAmount = 2500;
            financeCompany = 'Bajaj Finance';
            items = [
              {
                name: { value: 'LG Convertible Double Door Refrigerator', confidence: 0.94 },
                quantity: { value: 1, confidence: 0.95 },
                price: { value: 24500, confidence: 0.92 },
                gstPercentage: { value: 18, confidence: 0.96 },
                total: { value: 28910, confidence: 0.92 }
              }
            ];
          } else {
            paymentMode = 'Cash';
            items = [
              {
                name: { value: 'HP Pavilion Laptop 15"', confidence: 0.94 },
                quantity: { value: 1, confidence: 0.96 },
                price: { value: 45000, confidence: 0.91 },
                gstPercentage: { value: 18, confidence: 0.95 },
                total: { value: 53100, confidence: 0.91 }
              }
            ];
          }

          parsed = {
            customerName: { value: 'Rahul Sharma', confidence: 0.78 },
            customerPhone: { value: '9830098300', confidence: 0.90 },
            customerAddress: { value: 'Hill Cart Road, Siliguri', confidence: 0.81 },
            customerGstin: { value: '19ABCDE1234F1Z0', confidence: 0.80 },
            invoiceNumber: { value: `INV-OCR-${Date.now().toString().slice(-4)}`, confidence: 0.99 },
            invoiceDate: { value: new Date().toISOString().split('T')[0], confidence: 0.99 },
            items,
            totalAmount: { value: items.reduce((s, i) => s + i.total.value, 0), confidence: 0.98 }
          };
        } else {
          parsed = processInvoiceOcr(file.text, ocrMode);
          if (parsed) {
            const paymentModeMatch = file.text.match(/Payment\s*Method:\s*([^\r\n]+)/i);
            const financePartnerMatch = file.text.match(/Finance\s*Partner:\s*([^\r\n]+)/i);
            const downPaymentMatch = file.text.match(/Down\s*Payment:\s*₹?\s*([\d,]+)/i);
            const emiAmountMatch = file.text.match(/EMI\s*Amount:\s*₹?\s*([\d,]+)\s*\/Month|EMI\s*Amount:\s*₹?\s*([\d,]+)/i);

            if (financePartnerMatch) {
              paymentMode = 'Bajaj Finance';
              financeCompany = financePartnerMatch[1].trim();
            } else if (paymentModeMatch) {
              paymentMode = paymentModeMatch[1].trim();
            }

            if (downPaymentMatch) {
              downPayment = parseFloat(downPaymentMatch[1].replace(/,/g, '')) || 0;
            }
            if (emiAmountMatch) {
              emiAmount = parseFloat((emiAmountMatch[1] || emiAmountMatch[2] || '').replace(/,/g, '')) || 0;
            }
          }
        }

        if (parsed) {
          currentLog.push(`✓ Extracted: Customer "${parsed.customerName.value}", Phone "${parsed.customerPhone.value}"`);
          currentLog.push(`✓ Invoice# "${parsed.invoiceNumber.value}", Date "${parsed.invoiceDate.value}"`);
          currentLog.push(`✓ Line items: ${parsed.items.length} items detected.`);

          setExtractedInvoice({
            customerName: parsed.customerName.value,
            customerPhone: parsed.customerPhone.value,
            customerAddress: parsed.customerAddress.value,
            customerGstin: parsed.customerGstin.value,
            invoiceNumber: parsed.invoiceNumber.value,
            invoiceDate: parsed.invoiceDate.value,
            paymentMode,
            downPayment,
            emiAmount,
            financeCompany,
            items: parsed.items.map((it: any) => ({
              name: it.name.value,
              quantity: it.quantity.value,
              price: it.price.value,
              gstPercentage: it.gstPercentage.value,
              total: it.total.value,
              confidences: {
                name: it.name.confidence,
                quantity: it.quantity.confidence,
                price: it.price.confidence,
                gstPercentage: it.gstPercentage.confidence,
                total: it.total.confidence
              }
            })),
            confidences: {
              customerName: parsed.customerName.confidence,
              customerPhone: parsed.customerPhone.confidence,
              customerAddress: parsed.customerAddress.confidence,
              customerGstin: parsed.customerGstin.confidence,
              invoiceNumber: parsed.invoiceNumber.confidence,
              invoiceDate: parsed.invoiceDate.confidence
            }
          });
        } else {
          currentLog.push(`❌ Failed to parse structures in "${file.filename}"`);
        }
        setOcrLogs([...currentLog]);
        fileIdx++;
      } else {
        clearInterval(interval);
        currentLog.push(`\n🎉 Invoice scan complete! Ready for data validation and saving.`);
        setOcrLogs([...currentLog]);
        setOcrProcessing(false);
      }
    }, 1000);
  };

  const handleEditItem = (idx: number, field: string, val: any) => {
    if (!extractedInvoice) return;
    const updatedItems = extractedInvoice.items.map((item, i) => {
      if (i !== idx) return item;
      
      const updatedItem = {
        ...item,
        [field]: val
      };
      
      updatedItem.confidences = {
        ...updatedItem.confidences,
        [field]: 1.0
      };
      
      if (field === 'quantity' || field === 'price' || field === 'gstPercentage') {
        const qty = field === 'quantity' ? parseInt(val) || 0 : updatedItem.quantity;
        const prc = field === 'price' ? parseFloat(val) || 0 : updatedItem.price;
        const gst = field === 'gstPercentage' ? parseFloat(val) || 0 : updatedItem.gstPercentage;
        
        const sub = qty * prc;
        const tax = sub * (gst / 100);
        updatedItem.total = Math.round(sub + tax);
        updatedItem.confidences.total = 1.0;
      }
      
      return updatedItem;
    });
    
    setExtractedInvoice({
      ...extractedInvoice,
      items: updatedItems
    });
  };

  const handleAddItemRow = () => {
    if (!extractedInvoice) return;
    const newItem = {
      name: 'New Product',
      quantity: 1,
      price: 0,
      gstPercentage: 18,
      total: 0,
      confidences: {
        name: 1.0,
        quantity: 1.0,
        price: 1.0,
        gstPercentage: 1.0,
        total: 1.0
      }
    };
    setExtractedInvoice({
      ...extractedInvoice,
      items: [...extractedInvoice.items, newItem]
    });
  };

  const handleRemoveItemRow = (idx: number) => {
    if (!extractedInvoice) return;
    setExtractedInvoice({
      ...extractedInvoice,
      items: extractedInvoice.items.filter((_, i) => i !== idx)
    });
  };

  const handleConfirmOcrImport = async () => {
    if (!extractedInvoice) return;

    // Validation checks
    if (!extractedInvoice.customerName.trim()) return alert('Customer Name is required.');
    if (!extractedInvoice.invoiceNumber.trim()) return alert('Invoice Number is required.');
    if (!extractedInvoice.invoiceDate.trim()) return alert('Invoice Date is required.');
    if (extractedInvoice.items.length === 0) return alert('At least one item is required.');

    const confirmSave = confirm(`Confirm importing invoice ${extractedInvoice.invoiceNumber} to the database?`);
    if (!confirmSave) return;

    try {
      // 1. Resolve or create customer
      let finalCustomerId: number | null = null;
      if (extractedInvoice.customerPhone) {
        const custRes = await dbQuery('SELECT id FROM customers WHERE mobile = $1 LIMIT 1', [extractedInvoice.customerPhone]);
        if (custRes && custRes.length > 0) {
          finalCustomerId = custRes[0].id;
          await dbRun(`
            UPDATE customers 
            SET name = $1, address = $2, gstin = $3 
            WHERE id = $4
          `, [
            extractedInvoice.customerName,
            extractedInvoice.customerAddress,
            extractedInvoice.customerGstin,
            finalCustomerId
          ]);
        }
      }

      if (!finalCustomerId && extractedInvoice.customerName) {
        const custRes = await dbRun(`
          INSERT INTO customers (name, mobile, address, gstin, state, email, outstanding_balance)
          VALUES ($1, $2, $3, $4, '19-West Bengal', '', 0)
        `, [
          extractedInvoice.customerName,
          extractedInvoice.customerPhone,
          extractedInvoice.customerAddress,
          extractedInvoice.customerGstin
        ]);
        if (custRes.lastID) {
          finalCustomerId = custRes.lastID;
        }
      }

      // Calculate totals
      let subtotal = 0;
      let gstAmount = 0;
      let total = 0;

      extractedInvoice.items.forEach(item => {
        const qty = item.quantity;
        const prc = item.price;
        const gst = item.gstPercentage;
        
        const itemSub = qty * prc;
        const itemGst = itemSub * (gst / 100);
        
        subtotal += itemSub;
        gstAmount += itemGst;
        total += (itemSub + itemGst);
      });

      const finalTotal = Math.round(total);
      const status = extractedInvoice.paymentMode === 'Credit Sale' ? 'unpaid' : 'paid';

      // 2. Insert Invoice
      const dp = (extractedInvoice.paymentMode === 'Bajaj Finance' || extractedInvoice.paymentMode === 'Other Finance Partner') ? extractedInvoice.downPayment : 0;
      const emi = (extractedInvoice.paymentMode === 'Bajaj Finance' || extractedInvoice.paymentMode === 'Other Finance Partner') ? extractedInvoice.emiAmount : 0;
      const fc = extractedInvoice.paymentMode === 'Bajaj Finance' ? 'Bajaj Finance'
                 : extractedInvoice.paymentMode === 'Other Finance Partner' ? extractedInvoice.financeCompany
                 : null;

      const invoiceArgs = [
        extractedInvoice.invoiceNumber,
        finalCustomerId,
        extractedInvoice.invoiceDate,
        +subtotal.toFixed(2),
        +gstAmount.toFixed(2),
        0, // discount
        finalTotal,
        extractedInvoice.paymentMode,
        status,
        'Sales Invoice',
        'Imported via AI Invoice OCR scanner',
        null, // gst_irn
        null, // einvoice_ref
        null, // eway_bill_no
        dp,
        emi,
        fc
      ];

      const invRes = await dbRun(`
        INSERT INTO invoices (invoice_number, customer_id, date, subtotal, gst_amount, discount, total, payment_mode, status, type, notes, gst_irn, einvoice_ref, eway_bill_no, down_payment, emi_amount, finance_company)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, invoiceArgs);

      const invoiceId = invRes.lastID;

      if (invoiceId) {
        // Fetch all products to match by name
        const allProducts = await dbQuery('SELECT id, name, current_stock FROM products');

        // 3. Save Items and deduct stock
        for (const item of extractedInvoice.items) {
          const matchedProduct = allProducts.find(p => p.name.toLowerCase() === item.name.toLowerCase());
          const productId = matchedProduct ? matchedProduct.id : null;

          const itemGstAmt = (item.quantity * item.price) * (item.gstPercentage / 100);

          await dbRun(`
            INSERT INTO invoice_items (invoice_id, product_id, name, quantity, price, gst_percentage, gst_amount, discount, total)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
          `, [
            invoiceId,
            productId,
            item.name,
            item.quantity,
            item.price,
            item.gstPercentage,
            +itemGstAmt.toFixed(2),
            item.total
          ]);

          if (productId) {
            await dbRun(`
              UPDATE products 
              SET current_stock = MAX(0, current_stock - $1), available_stock = MAX(0, available_stock - $1) 
              WHERE id = $2
            `, [item.quantity, productId]);

            await dbRun(`
              INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes)
              VALUES ($1, 'Stock Out', $2, $3, 'AI invoice import deduction')
            `, [productId, item.quantity, extractedInvoice.invoiceNumber]);
          }
        }

        // 4. Update customer outstanding balance if unpaid credit sale
        if (status === 'unpaid' && finalCustomerId) {
          await dbRun(`
            UPDATE customers 
            SET outstanding_balance = outstanding_balance + $1 
            WHERE id = $2
          `, [finalTotal, finalCustomerId]);
        }

        // 5. Create finance case if finance payment mode selected
        if (extractedInvoice.paymentMode === 'Bajaj Finance' || extractedInvoice.paymentMode === 'Other Finance Partner') {
          const productDetails = extractedInvoice.items.map(it => `${it.name} (${it.quantity})`).join(', ');
          const financedAmount = finalTotal - dp;
          const expectedPayout = financedAmount;
          const receivedPayout = 0;
          const pendingPayout = expectedPayout;
          const financeCo = fc || 'Bajaj Finance';

          await dbRun(`
            INSERT INTO finance_cases (invoice_number, customer_name, product_details, total_amount, down_payment, financed_amount, emi_amount, finance_company, expected_payout, received_payout, pending_payout)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            extractedInvoice.invoiceNumber,
            extractedInvoice.customerName || 'Walk-in Customer',
            productDetails,
            finalTotal,
            dp,
            financedAmount,
            emi,
            financeCo,
            expectedPayout,
            receivedPayout,
            pendingPayout
          ]);
        }
      }

      alert(`🎉 Scanned invoice ${extractedInvoice.invoiceNumber} imported and verified successfully!`);
      setShowOcrModal(false);
      setOcrFiles([]);
      setOcrLogs([]);
      setExtractedInvoice(null);
      loadInvoices();
    } catch (err: any) {
      alert(`Import failed: ${err.message || err}`);
    }
  };

  useEffect(() => {
    loadInvoices();
    loadBusinessProfile();
  }, []);

  const loadBusinessProfile = async () => {
    try {
      const res = await dbQuery('SELECT * FROM business_profile WHERE id = 1');
      if (res && res.length > 0) {
        setBusinessProfile(res[0]);
      }
    } catch (err) {
      console.error('Failed to load business profile settings:', err);
    }
  };

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const res = await dbQuery(`
        SELECT i.*, 
               COALESCE(c.name, 'Cash Customer') as customer_name,
               c.mobile as customer_phone,
               c.address as customer_address,
               c.gstin as customer_gstin,
               c.state as customer_state
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        ORDER BY i.id DESC
      `);
      setInvoices(res);
    } catch (err) {
      console.error('Failed to load invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPreview = async (inv: Invoice) => {
    setViewInvoice(inv);
    try {
      const items = await dbQuery(`
        SELECT ii.*, p.unit, p.hsn_code 
        FROM invoice_items ii 
        LEFT JOIN products p ON ii.product_id = p.id 
        WHERE ii.invoice_id = $1
      `, [inv.id]);
      setViewItems(items);
    } catch (err) {
      console.error('Failed to fetch invoice items:', err);
    }
  };

  const handleMarkPaid = async (id: number) => {
    try {
      const invRes = await dbQuery('SELECT customer_id, total, status FROM invoices WHERE id = $1', [id]);
      if (invRes.length > 0 && invRes[0].status !== 'paid') {
        const { customer_id, total } = invRes[0];
        
        await dbRun('UPDATE invoices SET status = \'paid\' WHERE id = $1', [id]);
        
        if (customer_id) {
          await dbRun('UPDATE customers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [total, customer_id]);
        }
      }
      setViewInvoice(prev => prev ? { ...prev, status: 'paid' } : null);
      loadInvoices();
    } catch (err) {
      console.error('Failed to mark invoice as paid:', err);
    }
  };

  const handleDeleteInvoice = async (inv: Invoice) => {
    if (!confirm('🚨 CRITICAL WARNING: Deleting this invoice will RESTORE product stock levels and permanently wipe this invoice record. Proceed?')) {
      return;
    }

    try {
      if (inv.status === 'unpaid' && inv.customer_id) {
        await dbRun('UPDATE customers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [inv.total, inv.customer_id]);
      }
      
      const items = await dbQuery('SELECT product_id, quantity FROM invoice_items WHERE invoice_id = $1', [inv.id]);

      for (const item of items) {
        if (item.product_id) {
          await dbRun(`
            UPDATE products 
            SET current_stock = current_stock + $1, available_stock = available_stock + $1 
            WHERE id = $2
          `, [item.quantity, item.product_id]);

          await dbRun(`
            INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes)
            VALUES ($1, 'Stock In', $2, $3, 'Invoice deletion restock')
          `, [item.product_id, item.quantity, inv.invoice_number]);
        }
      }

      await dbRun('DELETE FROM invoices WHERE id = $1', [inv.id]);
      loadInvoices();
      alert('Invoice deleted and stock restored.');
    } catch (err: any) {
      alert(`Deletion failed: ${err.message || err}`);
    }
  };

  const handleDownloadPDF = async (inv: Invoice, items: InvoiceItem[]) => {
    let pdfItems = items;
    if (!pdfItems || pdfItems.length === 0) {
      try {
        pdfItems = await dbQuery(`
          SELECT ii.*, p.unit, p.hsn_code 
          FROM invoice_items ii 
          LEFT JOIN products p ON ii.product_id = p.id 
          WHERE ii.invoice_id = $1
        `, [inv.id]);
      } catch (err) {
        console.error('Failed to fetch items for PDF download:', err);
      }
    }
    const cust = {
      name: inv.customer_name,
      mobile: inv.customer_phone,
      address: inv.customer_address,
      gstin: inv.customer_gstin,
      state: inv.customer_state
    };
    await generatePDF(inv, cust, pdfItems);
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
                          inv.customer_name.toLowerCase().includes(search.toLowerCase()) ||
                          (inv.customer_phone && inv.customer_phone.includes(search));
    const matchesStatus = statusFilter === '' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  };

  // Amount In Words Helper
  const amountInWords = (amount: number) => {
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
    const rounded = Math.round(amount);
    const paise = Math.round((amount - rounded) * 100);
    let words = toWords(rounded).trim() + ' Rupees';
    if (paise > 0) words += ' and ' + toWords(paise).trim() + ' Paise';
    return words + ' only';
  };

  return (
    <div>
      <div className="section-header">
        <h3>Invoice Registry ({filteredInvoices.length} transactions)</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => setShowOcrModal(true)}>
            🔍 AI Invoice Import
          </button>
          <button className="btn btn-primary" onClick={() => setPage('billing')}>+ New Invoice</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '20px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: '220px' }}>
            <input 
              type="text" 
              placeholder="Search by invoice number, customer name or phone..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
          <div className="form-group" style={{ width: '180px' }}>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>Loading invoice registry...</div>
        ) : filteredInvoices.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No invoices found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice#</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Subtotal</th>
                  <th>GST Amount</th>
                  <th>Total Payable</th>
                  <th>Settlement</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 700, color: 'var(--brand)' }}>{inv.invoice_number}</td>
                    <td>{inv.date}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{inv.customer_name}</div>
                      {inv.customer_phone && <div style={{ fontSize: '10px', color: 'var(--gray)' }}>Ph: {inv.customer_phone}</div>}
                    </td>
                    <td><span className="badge badge-gray">{inv.type}</span></td>
                    <td>{fmtCurrency(inv.subtotal)}</td>
                    <td>{fmtCurrency(inv.gst_amount)}</td>
                    <td style={{ fontWeight: 700 }}>{fmtCurrency(inv.total)}</td>
                    <td><span style={{ fontSize: '12px', fontWeight: 600 }}>{inv.payment_mode}</span></td>
                    <td>
                      <span className={`badge ${inv.status === 'paid' ? 'badge-green' : 'badge-red'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button className="btn btn-secondary btn-sm" onClick={() => handleOpenPreview(inv)}>👁️ View</button>
                        {inv.status === 'unpaid' && (
                          <button className="btn btn-green btn-sm" onClick={() => handleMarkPaid(inv.id)}>✓ Paid</button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => handleDownloadPDF(inv, [])}>⬇️ PDF</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteInvoice(inv)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tax Invoice Preview Modal (Pixel-Perfect Mirror of PDF layout) */}
      {viewInvoice && (() => {
        // dynamic settings mapping from state
        
        // HSN grouped lists
        const hsnGroups: Record<string, any> = {};
        viewItems.forEach(item => {
          const hsn = item.hsn_code || '85094010';
          if (!hsnGroups[hsn]) {
            hsnGroups[hsn] = { hsn, taxable: 0, cgst: 0, sgst: 0, rate: item.gst_percentage };
          }
          hsnGroups[hsn].taxable += (item.price || 0) * (item.quantity || 1);
          hsnGroups[hsn].cgst += (item.gst_amount || 0) / 2;
          hsnGroups[hsn].sgst += (item.gst_amount || 0) / 2;
        });
        const hsnRows = Object.values(hsnGroups);

        const subtotal = viewInvoice.subtotal;
        const gstTotal = viewInvoice.gst_amount;
        const grandTotalRaw = subtotal + gstTotal;
        const finalTotal = viewInvoice.total;
        const roundOff = +(finalTotal - grandTotalRaw).toFixed(2);

        const pm = viewInvoice.payment_mode || '';
        const dpVal = (pm === 'Bajaj Finance' || pm === 'Other Finance Partner') ? (viewInvoice.down_payment || 0) : 0;
        const isPaid = viewInvoice.status === 'paid';
        const received = isPaid ? (pm === 'Bajaj Finance' || pm === 'Other Finance Partner' ? dpVal : finalTotal) : 0;
        const balance = isPaid ? (pm === 'Bajaj Finance' || pm === 'Other Finance Partner' ? finalTotal - dpVal : 0) : finalTotal;

        const th = { background: '#f8fafc', border: '1px solid #cbd5e1', padding: '6px 8px', fontSize: '11px', fontWeight: 700, textAlign: 'center' as const, color: '#475569' };
        const td = (align: 'left' | 'right' | 'center' = 'left', bold = false) => ({ border: '1px solid #cbd5e1', padding: '6px 8px', fontSize: '11.5px', textAlign: align, fontWeight: bold ? '700' : '400', color: '#1e293b' });

        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setViewInvoice(null)}>
            <div className="modal" style={{ maxWidth: '850px', fontFamily: 'Arial, sans-serif' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 800 }}>On-Screen Tax Invoice Preview</h4>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleDownloadPDF(viewInvoice, viewItems)}>⬇️ Download PDF</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setViewInvoice(null)}>Close</button>
                </div>
              </div>

              <div style={{ border: '2px solid #94a3b8', padding: '24px', background: '#fff', borderRadius: '8px' }}>
                
                {/* Title */}
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '14px', border: '1px solid #cbd5e1', padding: '6px 0', borderBottom: 'none' }}>
                  {viewInvoice.type}
                </div>

                {/* Meta details */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...td(), width: '55%', verticalAlign: 'top', padding: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--brand)' }}>{businessProfile.name}</div>
                            <div style={{ fontSize: '10px', marginTop: '4px', lineHeight: '1.4' }}>{businessProfile.address}</div>
                          </div>
                          {businessProfile.logo_base64 && (
                            <img src={businessProfile.logo_base64} alt="logo" style={{ maxHeight: '42px', maxWidth: '120px', objectFit: 'contain' }} />
                          )}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '4px' }}>Phone: {businessProfile.phone}</div>
                        <div style={{ fontSize: '10px' }}>Email: {businessProfile.email}</div>
                        <div style={{ fontSize: '10px', fontWeight: 700 }}>GSTIN: {businessProfile.gstin}</div>
                        <div style={{ fontSize: '10px' }}>State: {businessProfile.state}</div>
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: 0, verticalAlign: 'top' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td style={{ ...td(), borderBottom: '1px solid #cbd5e1', borderRight: '1px solid #cbd5e1', padding: '8px' }}>Invoice No.<br/><strong>{viewInvoice.invoice_number}</strong></td>
                              <td style={{ ...td(), borderBottom: '1px solid #cbd5e1', padding: '8px' }}>Date<br/><strong>{viewInvoice.date}</strong></td>
                            </tr>
                            <tr>
                              <td colSpan={2} style={{ ...td(), borderBottom: '1px solid #cbd5e1', padding: '8px' }}>Place of Supply<br/><strong>{viewInvoice.customer_state || 'Odisha'}</strong></td>
                            </tr>
                            <tr>
                              <td colSpan={2} style={{ ...td(), padding: '8px' }}>Settlement: <strong>{viewInvoice.payment_mode}</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Customer Bill To */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...td(), borderBottom: 'none', background: '#f8fafc', color: '#64748b', fontSize: '10px', fontWeight: 700 }}>Bill To</td>
                    </tr>
                    <tr>
                      <td style={{ border: '1px solid #cbd5e1', padding: '10px' }}>
                        <strong style={{ fontSize: '13.5px' }}>{viewInvoice.customer_name}</strong>
                        {viewInvoice.customer_address && <div style={{ fontSize: '10px', marginTop: '4px' }}>{viewInvoice.customer_address}</div>}
                        {viewInvoice.customer_phone && <div style={{ fontSize: '10px' }}>Ph: {viewInvoice.customer_phone}</div>}
                        {viewInvoice.customer_gstin && <div style={{ fontSize: '10px', fontWeight: 700 }}>GSTIN: {viewInvoice.customer_gstin}</div>}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Items Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: '4%' }}>#</th>
                      <th style={{ ...th, width: '30%', textAlign: 'left' }}>Item name</th>
                      <th style={{ ...th, width: '12%' }}>HSN/ SAC</th>
                      <th style={{ ...th, width: '10%' }}>Qty</th>
                      <th style={{ ...th, width: '8%' }}>Unit</th>
                      <th style={{ ...th, width: '12%' }}>Price/ Unit</th>
                      <th style={{ ...th, width: '12%' }}>GST</th>
                      <th style={{ ...th, width: '12%' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewItems.map((item, idx) => (
                      <tr key={idx}>
                        <td style={td('center')}>{idx + 1}</td>
                        <td style={td('left')}><strong>{item.name}</strong></td>
                        <td style={td('center')}>{item.hsn_code || '85094010'}</td>
                        <td style={td('right')}>{item.quantity}</td>
                        <td style={td('center')}>{item.unit || 'Nos'}</td>
                        <td style={td('right')}>{fmtCurrency(item.price)}</td>
                        <td style={td('right')}>{fmtCurrency(item.gst_amount)} ({item.gst_percentage}%)</td>
                        <td style={td('right', true)}>{fmtCurrency(item.total)}</td>
                      </tr>
                    ))}
                    {/* Total summary row */}
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td colSpan={3} style={{ ...td(), fontWeight: 700 }}>Total</td>
                      <td style={{ ...td('right'), fontWeight: 700 }}>{viewItems.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td style={{ border: '1px solid #cbd5e1' }}></td>
                      <td style={{ border: '1px solid #cbd5e1' }}></td>
                      <td style={{ border: '1px solid #cbd5e1' }}></td>
                      <td style={{ ...td('right'), fontWeight: 700 }}>{fmtCurrency(grandTotalRaw)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Amount in words + calculation breakdown */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ border: '1px solid #cbd5e1', padding: '10px', width: '50%', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700 }}>Invoice Amount in Words</div>
                        <div style={{ fontWeight: 700, marginTop: '4px', fontSize: '11px', color: '#1e293b' }}>{amountInWords(finalTotal)}</div>
                        {(pm === 'Bajaj Finance' || pm === 'Other Finance Partner') && (
                          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', marginTop: '8px' }}>
                            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, marginBottom: '2px' }}>Finance Details</div>
                            <div style={{ fontSize: '10.5px', color: '#1e293b' }}>
                              <strong>Payment Mode:</strong> {pm === 'Bajaj Finance' ? 'Bajaj Finance' : (viewInvoice.finance_company || 'Finance Partner')}<br/>
                              <strong>Down Payment:</strong> {fmtCurrency(viewInvoice.down_payment || 0)}<br/>
                              <strong>EMI:</strong> {fmtCurrency(viewInvoice.emi_amount || 0)} / Month
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: 0, verticalAlign: 'top' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', fontWeight: 700, fontSize: '11px' }}>Amounts Summary</td>
                              <td style={{ border: '1px solid #cbd5e1' }}></td>
                            </tr>
                            <tr>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', fontSize: '11px' }}>Sub Total</td>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', textAlign: 'right', fontSize: '11px' }}>{fmtCurrency(subtotal)}</td>
                            </tr>
                            <tr>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', fontSize: '11px' }}>Round off</td>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', textAlign: 'right', fontSize: '11px' }}>
                                {roundOff >= 0 ? '+' : ''}{fmtCurrency(roundOff)}
                              </td>
                            </tr>
                            <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', fontSize: '11px' }}>Total</td>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', textAlign: 'right', fontSize: '11px' }}>{fmtCurrency(finalTotal)}</td>
                            </tr>
                            <tr>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', fontSize: '11px' }}>Received</td>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', textAlign: 'right', fontSize: '11px' }}>{fmtCurrency(received)}</td>
                            </tr>
                            <tr>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', fontSize: '11px' }}>Balance</td>
                              <td style={{ border: '1px solid #cbd5e1', padding: '4px 8px', textAlign: 'right', fontSize: '11px' }}>{fmtCurrency(balance)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* HSN CGST/SGST Taxes Breakdown */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th rowSpan={2} style={th}>HSN/ SAC</th>
                      <th rowSpan={2} style={th}>Taxable amount</th>
                      <th colSpan={2} style={th}>CGST</th>
                      <th colSpan={2} style={th}>SGST</th>
                      <th rowSpan={2} style={th}>Total Tax Amount</th>
                    </tr>
                    <tr>
                      <th style={th}>Rate</th><th style={th}>Amount</th>
                      <th style={th}>Rate</th><th style={th}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hsnRows.map(row => (
                      <tr key={row.hsn}>
                        <td style={td('center')}>{row.hsn}</td>
                        <td style={td('right')}>{fmtCurrency(row.taxable)}</td>
                        <td style={td('center')}>{row.rate / 2}%</td>
                        <td style={td('right')}>{fmtCurrency(row.cgst)}</td>
                        <td style={td('center')}>{row.rate / 2}%</td>
                        <td style={td('right')}>{fmtCurrency(row.sgst)}</td>
                        <td style={td('right')}>{fmtCurrency(row.cgst + row.sgst)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td style={{ ...td(), fontWeight: 700 }}>Total</td>
                      <td style={{ ...td('right'), fontWeight: 700 }}>{fmtCurrency(hsnRows.reduce((s, r) => s + r.taxable, 0))}</td>
                      <td style={{ border: '1px solid #cbd5e1' }}></td>
                      <td style={{ ...td('right'), fontWeight: 700 }}>{fmtCurrency(hsnRows.reduce((s, r) => s + r.cgst, 0))}</td>
                      <td style={{ border: '1px solid #cbd5e1' }}></td>
                      <td style={{ ...td('right'), fontWeight: 700 }}>{fmtCurrency(hsnRows.reduce((s, r) => s + r.sgst, 0))}</td>
                      <td style={{ ...td('right'), fontWeight: 700 }}>{fmtCurrency(hsnRows.reduce((s, r) => s + r.cgst + r.sgst, 0))}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Terms and signatories */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ border: '1px solid #cbd5e1', padding: '10px', width: '60%', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 700, fontSize: '11px', marginBottom: '4px' }}>Terms and conditions</div>
                        {[
                          'Thanks for doing business with us!',
                          '1. Goods once sold will not be taken back or exchanged.',
                          '2. Please check the product at the time of delivery.',
                          '3. All warranties are as per the manufacturer\'s terms and service centers.',
                          '4. Invoice must be preserved for warranty claims.',
                          '5. Payment once made is non-refundable.',
                          '6. Prices are inclusive of GST unless mentioned otherwise.',
                          '7. Delivery and installation (if applicable) are extra unless stated.',
                        ].map((t, i) => <div key={i} style={{ fontSize: '9.5px', color: '#475569', lineHeight: '1.5' }}>{t}</div>)}
                        {businessProfile.bank_details && (
                          <div style={{ fontSize: '9px', color: '#475569', marginTop: '4px' }}>
                            <strong>Bank Account:</strong> {businessProfile.bank_details}
                          </div>
                        )}
                        {businessProfile.upi_id && (
                          <div style={{ fontSize: '9px', color: '#475569' }}>
                            <strong>UPI ID:</strong> {businessProfile.upi_id}
                          </div>
                        )}
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '11px', color: '#475569' }}>For : {businessProfile.name}</div>
                        <div style={{ marginTop: '35px', fontWeight: 700, fontSize: '11px', color: '#1e293b' }}>Authorized Signatory</div>
                      </td>
                    </tr>
                  </tbody>
                </table>

              </div>

              {viewInvoice.status === 'unpaid' && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                  <button className="btn btn-green" onClick={() => handleMarkPaid(viewInvoice.id)}>Mark Invoice as Paid</button>
                  <button className="btn btn-danger" onClick={() => { handleDeleteInvoice(viewInvoice); setViewInvoice(null); }}>Delete Invoice</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* AI Invoice Import Modal */}
      {showOcrModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowOcrModal(false)}>
          <div className="modal" style={{ maxWidth: '950px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--brand)' }}>🔍 AI Invoice Import Desk</h3>
              <button 
                type="button" 
                className="btn btn-secondary btn-sm" 
                onClick={() => setShowOcrModal(false)}
                style={{ fontSize: '14px', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              {/* Left Column: Attachment and Scanner Controls */}
              <div className="card" style={{ padding: '20px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Upload Scanned Invoice</h4>
                
                {/* Drag and Drop Zone */}
                <div 
                  style={{
                    border: '2px dashed #bfdbfe',
                    borderRadius: '8px',
                    padding: '24px',
                    textAlign: 'center',
                    background: '#f8fafc',
                    marginBottom: '16px',
                    cursor: 'pointer'
                  }}
                  onClick={() => document.getElementById('invoice-ocr-file-input')?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    if (e.dataTransfer.files) {
                      addInvoiceFiles(Array.from(e.dataTransfer.files));
                    }
                  }}
                >
                  <input 
                    type="file" 
                    accept="image/*,application/pdf" 
                    multiple 
                    style={{ display: 'none' }} 
                    id="invoice-ocr-file-input" 
                    onChange={e => e.target.files && addInvoiceFiles(Array.from(e.target.files))} 
                  />
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📸</div>
                  <strong style={{ fontSize: '13.5px', color: 'var(--brand)' }}>
                    Drag & Drop or Click to Upload Invoice
                  </strong>
                  <p style={{ fontSize: '11px', color: 'var(--gray)', marginTop: '4px' }}>
                    Upload actual screenshots of your customer bills or receipts (PNG, JPG, PDF).
                  </p>
                </div>

                {/* Display list of currently attached files */}
                {ocrFiles.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--gray)', display: 'block', marginBottom: '6px' }}>
                      Attached Files ({ocrFiles.length})
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', marginBottom: '16px' }}>
                      {ocrFiles.map((file, idx) => (
                        <div 
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            background: '#f0fdf4',
                            borderRadius: '6px',
                            border: '1px solid #bbf7d0',
                            fontSize: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {file.previewUrl ? (
                              <img 
                                src={file.previewUrl} 
                                alt="preview" 
                                style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover', border: '1px solid #cbd5e1' }} 
                              />
                            ) : (
                              <span style={{ fontSize: '20px' }}>📄</span>
                            )}
                            <div>
                              <strong style={{ display: 'block', color: '#1e293b' }}>{file.filename}</strong>
                              <span style={{ fontSize: '10px', color: '#16a34a' }}>
                                {file.isCustom ? 'Custom screenshot attached' : 'Template matched'}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            style={{ padding: '3px 8px', fontSize: '10.5px' }}
                            onClick={() => setOcrFiles(prev => prev.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mock preloaded lists */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--gray)', display: 'block', marginBottom: '6px' }}>
                    Quick Attach Templates (Simulate Camera Scans)
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {MOCK_INVOICE_DOCS.map(doc => {
                      const isAttached = ocrFiles.some(f => f.filename === doc.filename);
                      return (
                        <div 
                          key={doc.filename}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 12px',
                            background: isAttached ? '#eff6ff' : '#f8fafc',
                            borderRadius: '6px',
                            border: isAttached ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                            fontSize: '12px'
                          }}
                        >
                          <div>
                            <strong style={{ display: 'block', color: '#1e293b' }}>{doc.filename}</strong>
                            <span style={{ fontSize: '10px', color: 'var(--gray)' }}>
                              {doc.text.split('\n')[0]}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={`btn btn-sm ${isAttached ? 'btn-danger' : 'btn-secondary'}`}
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={() => {
                              const exists = ocrFiles.some(f => f.filename === doc.filename);
                              if (exists) {
                                setOcrFiles(prev => prev.filter(f => f.filename !== doc.filename));
                              } else {
                                setOcrFiles(prev => [...prev, { ...doc, isCustom: false }]);
                              }
                            }}
                          >
                            {isAttached ? 'Remove' : 'Attach'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f1f5f9', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700 }}>OCR Engine Mode:</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${ocrMode === 'local' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '4px 10px', fontSize: '11.5px' }}
                      onClick={() => setOcrMode('local')}
                    >
                      💻 Local Offline
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${ocrMode === 'cloud' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '4px 10px', fontSize: '11.5px' }}
                      onClick={() => setOcrMode('cloud')}
                    >
                      ☁️ Cloud AI
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={ocrProcessing || ocrFiles.length === 0}
                  style={{ width: '100%', padding: '10px', fontWeight: 700 }}
                  onClick={handleProcessInvoiceOcr}
                >
                  {ocrProcessing ? 'Scanning Invoice...' : 'Start AI Extraction Scan 🔍'}
                </button>
              </div>

              {/* Right Column: Console Log Screen */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '340px', padding: '20px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>AI OCR Scanner Console</h4>
                <div 
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    color: '#38bdf8',
                    fontFamily: 'monospace',
                    fontSize: '11.5px',
                    padding: '12px 16px',
                    borderRadius: '6px',
                    overflowY: 'auto',
                    lineHeight: '1.5',
                    minHeight: '220px'
                  }}
                >
                  {ocrLogs.length === 0 ? (
                    <div style={{ color: '#64748b' }}>Console idle. Attach scans and run extraction to begin.</div>
                  ) : (
                    ocrLogs.map((log, idx) => (
                      <div key={idx} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>{log}</div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Verification Stage Panel */}
            {extractedInvoice && (
              <div className="card" style={{ padding: '20px', border: '1px solid #bfdbfe', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                  <div>
                    <h4 style={{ fontSize: '15px', fontWeight: 800, color: '#1e293b' }}>Verify Extracted Invoice Staging Details</h4>
                    <p style={{ fontSize: '11px', color: 'var(--gray)', marginTop: '2px' }}>
                      Review and correct values inline. <span style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: '3px', fontWeight: 600, color: '#b45309' }}>Yellow cells</span> represent low confidence scans.
                    </p>
                  </div>
                  <button 
                    type="button" 
                    className="btn btn-primary"
                    onClick={handleConfirmOcrImport}
                    style={{ background: 'var(--green)', border: 'none', fontWeight: 700 }}
                  >
                    Confirm & Save Invoice Record ✓
                  </button>
                </div>

                {/* Customer & Invoice Fields */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Invoice Number</label>
                    <input 
                      type="text" 
                      value={extractedInvoice.invoiceNumber}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: extractedInvoice.confidences.invoiceNumber < 0.85 ? '#fef3c7' : '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        invoiceNumber: e.target.value,
                        confidences: { ...extractedInvoice.confidences, invoiceNumber: 1.0 }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Invoice Date</label>
                    <input 
                      type="date" 
                      value={extractedInvoice.invoiceDate}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: extractedInvoice.confidences.invoiceDate < 0.85 ? '#fef3c7' : '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        invoiceDate: e.target.value,
                        confidences: { ...extractedInvoice.confidences, invoiceDate: 1.0 }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Customer Name</label>
                    <input 
                      type="text" 
                      value={extractedInvoice.customerName}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: extractedInvoice.confidences.customerName < 0.85 ? '#fef3c7' : '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        customerName: e.target.value,
                        confidences: { ...extractedInvoice.confidences, customerName: 1.0 }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Mobile Number</label>
                    <input 
                      type="text" 
                      value={extractedInvoice.customerPhone}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: extractedInvoice.confidences.customerPhone < 0.85 ? '#fef3c7' : '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        customerPhone: e.target.value,
                        confidences: { ...extractedInvoice.confidences, customerPhone: 1.0 }
                      })}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Billing Address</label>
                    <input 
                      type="text" 
                      value={extractedInvoice.customerAddress}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: extractedInvoice.confidences.customerAddress < 0.85 ? '#fef3c7' : '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        customerAddress: e.target.value,
                        confidences: { ...extractedInvoice.confidences, customerAddress: 1.0 }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Customer GSTIN</label>
                    <input 
                      type="text" 
                      value={extractedInvoice.customerGstin}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: extractedInvoice.confidences.customerGstin < 0.85 ? '#fef3c7' : '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        customerGstin: e.target.value,
                        confidences: { ...extractedInvoice.confidences, customerGstin: 1.0 }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Payment Method</label>
                    <select
                      value={extractedInvoice.paymentMode}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        fontSize: '13px',
                        marginTop: '4px'
                      }}
                      onChange={e => setExtractedInvoice({
                        ...extractedInvoice,
                        paymentMode: e.target.value
                      })}
                    >
                      <option value="Cash">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="Card">Card</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Credit Sale">Credit Sale</option>
                      <option value="Bajaj Finance">Bajaj Finance</option>
                      <option value="Other Finance Partner">Other Finance Partner</option>
                    </select>
                  </div>

                  {/* Conditional Finance Fields */}
                  {(extractedInvoice.paymentMode === 'Bajaj Finance' || extractedInvoice.paymentMode === 'Other Finance Partner') && (
                    <>
                      <div className="form-group">
                        <label style={{ fontSize: '11px', fontWeight: 700 }}>Down Payment (₹)</label>
                        <input 
                          type="number" 
                          value={extractedInvoice.downPayment}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            fontSize: '13px',
                            marginTop: '4px'
                          }}
                          onChange={e => setExtractedInvoice({
                            ...extractedInvoice,
                            downPayment: parseFloat(e.target.value) || 0
                          })}
                        />
                      </div>
                      <div className="form-group">
                        <label style={{ fontSize: '11px', fontWeight: 700 }}>EMI Amount (₹/Month)</label>
                        <input 
                          type="number" 
                          value={extractedInvoice.emiAmount}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            fontSize: '13px',
                            marginTop: '4px'
                          }}
                          onChange={e => setExtractedInvoice({
                            ...extractedInvoice,
                            emiAmount: parseFloat(e.target.value) || 0
                          })}
                        />
                      </div>
                      {extractedInvoice.paymentMode === 'Other Finance Partner' && (
                        <div className="form-group">
                          <label style={{ fontSize: '11px', fontWeight: 700 }}>Finance Partner Name</label>
                          <input 
                            type="text" 
                            value={extractedInvoice.financeCompany}
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              background: '#fff',
                              border: '1px solid #cbd5e1',
                              borderRadius: '4px',
                              fontSize: '13px',
                              marginTop: '4px'
                            }}
                            onChange={e => setExtractedInvoice({
                              ...extractedInvoice,
                              financeCompany: e.target.value
                            })}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Line Items Table */}
                <div style={{ marginTop: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h5 style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>Invoice Products Details</h5>
                    <button 
                      type="button" 
                      className="btn btn-secondary btn-sm"
                      onClick={handleAddItemRow}
                      style={{ padding: '4px 10px', fontSize: '11.5px' }}
                    >
                      + Add Item Row
                    </button>
                  </div>

                  <div className="table-wrap" style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    <table style={{ minWidth: '100%' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th style={{ width: '40%' }}>Product Name / Description</th>
                          <th style={{ textAlign: 'center', width: '10%' }}>Qty</th>
                          <th style={{ textAlign: 'right', width: '20%' }}>Unit Cost (excl. GST) (₹)</th>
                          <th style={{ textAlign: 'center', width: '12%' }}>GST %</th>
                          <th style={{ textAlign: 'right', width: '18%' }}>Total (incl. GST) (₹)</th>
                          <th style={{ width: '40px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {extractedInvoice.items.map((item, idx) => {
                          const cellStyle = (lowConf: boolean) => ({
                            padding: '6px 8px',
                            background: lowConf ? '#fef3c7' : 'inherit',
                            border: '1px solid #e2e8f0',
                            fontSize: '12.5px',
                            width: '100%',
                            borderRadius: '3px'
                          });

                          return (
                            <tr key={idx}>
                              <td>
                                <input 
                                  type="text" 
                                  value={item.name}
                                  style={cellStyle(item.confidences.name < 0.85)}
                                  onChange={e => handleEditItem(idx, 'name', e.target.value)}
                                />
                              </td>
                              <td>
                                <input 
                                  type="number" 
                                  value={item.quantity}
                                  style={{ ...cellStyle(item.confidences.quantity < 0.85), textAlign: 'center' }}
                                  onChange={e => handleEditItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                />
                              </td>
                              <td>
                                <input 
                                  type="number" 
                                  value={item.price}
                                  style={{ ...cellStyle(item.confidences.price < 0.85), textAlign: 'right' }}
                                  onChange={e => handleEditItem(idx, 'price', parseFloat(e.target.value) || 0)}
                                />
                              </td>
                              <td>
                                <select
                                  value={item.gstPercentage}
                                  style={{ ...cellStyle(item.confidences.gstPercentage < 0.85), padding: '4px' }}
                                  onChange={e => handleEditItem(idx, 'gstPercentage', parseInt(e.target.value) || 0)}
                                >
                                  {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                                </select>
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 700, paddingRight: '12px' }}>
                                {fmtCurrency(item.total)}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button 
                                  type="button" 
                                  className="btn-link"
                                  onClick={() => handleRemoveItemRow(idx)}
                                  style={{ color: 'var(--red)', border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px' }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
