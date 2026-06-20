'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { dbQuery, dbRun } from '@/lib/api';
import { generatePDF } from '@/lib/pdf-generator';

interface Product {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  selling_price: number;
  gst_percentage: number;
  current_stock: number;
  unit: string;
  hsn_code: string;
}

interface Customer {
  id: number;
  name: string;
  mobile: string;
  address: string;
  gstin: string;
  state: string;
  email?: string;
}

interface LineItem {
  product_id: number | null;
  name: string;
  quantity: number;
  price: number; // base price excl. GST
  gst_percentage: number;
  gst_amount: number;
  discount: number; // discount amount on the row
  total: number;
  unit: string;
  hsn_code: string;
}

export default function BillingView({ setPage }: { setPage: (page: string) => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);

  // Form State
  const [customerId, setCustomerId] = useState('');
  const [billingName, setBillingName] = useState('');
  const [billingPhone, setBillingPhone] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingGstin, setBillingGstin] = useState('');
  const [billingState, setBillingState] = useState('19-West Bengal');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [invoiceType] = useState('Tax Invoice'); // Locked default
  const [isCreditSale, setIsCreditSale] = useState(false); // Sale mode toggle
  const [paymentMode, setPaymentMode] = useState('Cash'); // Cash, UPI, Card, etc.
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([
    { product_id: null, name: '', quantity: 1, price: 0, gst_percentage: 18, gst_amount: 0, discount: 0, total: 0, unit: 'Nos', hsn_code: '' }
  ]);

  // Round Off checkbox toggle
  const [roundOffEnabled, setRoundOffEnabled] = useState(true);

  // Suggestions states
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null);
  const [rowSearchQuery, setRowSearchQuery] = useState('');

  // GST Compliance Fields
  const [gstIrn, setGstIrn] = useState('');
  const [einvoiceRef, setEinvoiceRef] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');

  // Offline recovery state
  const [draftDetected, setDraftDetected] = useState(false);
  const [draftData, setDraftData] = useState<any>(null);

  // Finance Partner States
  const [downPayment, setDownPayment] = useState<string>('0');
  const [emiAmount, setEmiAmount] = useState<string>('0');
  const [financeCompany, setFinanceCompany] = useState<string>('Bajaj Finance');
  const [financePartners, setFinancePartners] = useState<string[]>([
    'Bajaj Finance',
    'HDB Finance',
    'Home Credit',
    'TVS Credit',
    'IDFC First Bank'
  ]);

  // Top search bar
  const [productSearch, setProductSearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    checkForDraft();

    // Register keyboard shortcut F3
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Save draft whenever invoice details change
  useEffect(() => {
    const isFormEmpty = items.length === 1 && items[0].name === '' && items[0].price === 0 && billingName === '';
    if (!isFormEmpty) {
      const draft = {
        customerId,
        billingName,
        billingPhone,
        billingAddress,
        billingGstin,
        billingState,
        invoiceDate,
        isCreditSale,
        paymentMode,
        notes,
        items,
        gstIrn,
        einvoiceRef,
        ewayBillNo,
        roundOffEnabled,
        downPayment,
        emiAmount,
        financeCompany
      };
      localStorage.setItem('em_billing_draft', JSON.stringify(draft));
    }
  }, [customerId, billingName, billingPhone, billingAddress, billingGstin, billingState, invoiceDate, isCreditSale, paymentMode, notes, items, gstIrn, einvoiceRef, ewayBillNo, roundOffEnabled, downPayment, emiAmount, financeCompany]);

  const loadData = async () => {
    try {
      const custs = await dbQuery('SELECT id, name, mobile, address, gstin, state, email FROM customers ORDER BY name ASC');
      setCustomers(custs);

      const prods = await dbQuery('SELECT id, name, sku, barcode, selling_price, gst_percentage, current_stock, unit, hsn_code FROM products');
      setProducts(prods);

      const invoices = await dbQuery('SELECT invoice_number FROM invoices');
      setInvoiceNumber(getNextInvoiceNo(invoices));

      const recs = await dbQuery(`
        SELECT i.*, COALESCE(c.name, 'Cash Customer') as customer_name 
        FROM invoices i 
        LEFT JOIN customers c ON i.customer_id = c.id 
        ORDER BY i.id DESC LIMIT 5
      `);
      setRecentInvoices(recs);

      // Load finance partners list
      try {
        const partners = await dbQuery('SELECT name FROM finance_partners ORDER BY name ASC');
        if (partners && partners.length > 0) {
          setFinancePartners(partners.map((p: any) => p.name));
          const firstPartner = partners[0]?.name;
          if (firstPartner) {
            setFinanceCompany(firstPartner);
          }
        }
      } catch (fpErr) {
        console.error('Failed to load finance partners list:', fpErr);
      }
    } catch (err) {
      console.error('Failed to load billing data:', err);
    }
  };

  const checkForDraft = () => {
    const savedDraft = localStorage.getItem('em_billing_draft');
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.items?.length > 0 && (parsed.items[0].name !== '' || parsed.billingName !== '')) {
          setDraftData(parsed);
          setDraftDetected(true);
        }
      } catch (e) {
        console.error('Failed to parse invoice draft:', e);
      }
    }
  };

  const handleRecoverDraft = () => {
    if (draftData) {
      setCustomerId(draftData.customerId || '');
      setBillingName(draftData.billingName || '');
      setBillingPhone(draftData.billingPhone || '');
      setBillingAddress(draftData.billingAddress || '');
      setBillingGstin(draftData.billingGstin || '');
      setBillingState(draftData.billingState || '19-West Bengal');
      setInvoiceDate(draftData.invoiceDate || new Date().toISOString().split('T')[0]);
      setIsCreditSale(draftData.isCreditSale || false);
      setPaymentMode(draftData.paymentMode || 'Cash');
      setNotes(draftData.notes || '');
      setItems(draftData.items || []);
      setGstIrn(draftData.gstIrn || '');
      setEinvoiceRef(draftData.einvoiceRef || '');
      setEwayBillNo(draftData.ewayBillNo || '');
      setRoundOffEnabled(draftData.roundOffEnabled !== undefined ? draftData.roundOffEnabled : true);
      setDownPayment(draftData.downPayment || '0');
      setEmiAmount(draftData.emiAmount || '0');
      setFinanceCompany(draftData.financeCompany || 'Bajaj Finance');
    }
    setDraftDetected(false);
    localStorage.removeItem('em_billing_draft');
  };

  const handleDiscardDraft = () => {
    localStorage.removeItem('em_billing_draft');
    setDraftDetected(false);
  };

  const getNextInvoiceNo = (invs: any[]) => {
    if (!invs.length) return 'INV-0001';
    const nums = invs.map(i => {
      const parts = i.invoice_number.split('-');
      const parsed = parseInt(parts[1]);
      return isNaN(parsed) ? 0 : parsed;
    });
    return `INV-${String(Math.max(...nums, 0) + 1).padStart(4, '0')}`;
  };

  const filteredProducts = useMemo(() => {
    if (!productSearch) return [];
    return products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku?.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [productSearch, products]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchName = billingName ? c.name.toLowerCase().includes(billingName.toLowerCase()) : true;
      const matchPhone = billingPhone ? c.mobile.includes(billingPhone) : true;
      return matchName && matchPhone;
    });
  }, [customers, billingName, billingPhone]);

  const matchedRowProducts = useMemo(() => {
    if (!rowSearchQuery) return [];
    return products.filter(p =>
      p.name.toLowerCase().includes(rowSearchQuery.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(rowSearchQuery.toLowerCase()) ||
      p.sku?.toLowerCase().includes(rowSearchQuery.toLowerCase())
    );
  }, [rowSearchQuery, products]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setProductSearch(val);
    setSearchIndex(-1);

    const matched = products.find(p => p.barcode === val.trim() || p.sku === val.trim());
    if (matched) {
      addProductToLines(matched);
      setProductSearch('');
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchIndex(prev => Math.min(prev + 1, filteredProducts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchIndex >= 0 && filteredProducts[searchIndex]) {
        addProductToLines(filteredProducts[searchIndex]);
        setProductSearch('');
        setSearchIndex(-1);
      } else if (filteredProducts.length > 0) {
        addProductToLines(filteredProducts[0]);
        setProductSearch('');
        setSearchIndex(-1);
      }
    }
  };

  const addProductToLines = (prod: Product) => {
    const existingIdx = items.findIndex(it => it.product_id === prod.id);
    if (existingIdx !== -1) {
      updateItem(existingIdx, 'quantity', items[existingIdx].quantity + 1);
    } else {
      const newItem: LineItem = {
        product_id: prod.id,
        name: prod.name,
        quantity: 1,
        price: prod.selling_price,
        gst_percentage: prod.gst_percentage,
        gst_amount: 0,
        discount: 0,
        total: 0,
        unit: prod.unit || 'Nos',
        hsn_code: prod.hsn_code || '85094010'
      };
      
      if (items.length === 1 && items[0].product_id === null && items[0].name === '') {
        setItems([newItem]);
      } else {
        setItems(prev => [...prev, newItem]);
      }
    }
  };

  const updateItem = (idx: number, key: keyof LineItem, val: any) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [key]: val };

      if (key === 'quantity' || key === 'price' || key === 'gst_percentage' || key === 'discount') {
        const qty = parseInt(updated.quantity as any) || 0;
        const price = parseFloat(updated.price as any) || 0;
        const gstRate = parseFloat(updated.gst_percentage as any) || 0;
        const disc = parseFloat(updated.discount as any) || 0;

        const subtotal = (price * qty) - disc;
        const gstAmount = subtotal * (gstRate / 100);
        const total = subtotal + gstAmount;

        updated.gst_amount = +gstAmount.toFixed(2);
        updated.total = +total.toFixed(2);
      }

      return updated;
    }));
  };

  const addItemRow = () => {
    setItems(prev => [...prev, {
      product_id: null, name: '', quantity: 1, price: 0, gst_percentage: 18, gst_amount: 0, discount: 0, total: 0, unit: 'Nos', hsn_code: ''
    }]);
  };

  const removeItemRow = (idx: number) => {
    if (items.length === 1) {
      setItems([{
        product_id: null, name: '', quantity: 1, price: 0, gst_percentage: 18, gst_amount: 0, discount: 0, total: 0, unit: 'Nos', hsn_code: ''
      }]);
    } else {
      setItems(prev => prev.filter((_, i) => i !== idx));
    }
  };

  const selectCustomer = (c: Customer) => {
    setCustomerId(c.id.toString());
    setBillingName(c.name);
    setBillingPhone(c.mobile || '');
    setBillingAddress(c.address || '');
    setBillingGstin(c.gstin || '');
    setBillingState(c.state || '19-West Bengal');
    setShowNameSuggestions(false);
    setShowPhoneSuggestions(false);
  };

  const selectRowProduct = (rowIdx: number, p: Product) => {
    updateItem(rowIdx, 'product_id', p.id);
    updateItem(rowIdx, 'name', p.name);
    updateItem(rowIdx, 'price', p.selling_price);
    updateItem(rowIdx, 'gst_percentage', p.gst_percentage);
    updateItem(rowIdx, 'unit', p.unit || 'Nos');
    updateItem(rowIdx, 'hsn_code', p.hsn_code || '85094010');
    setFocusedRowIdx(null);
    setRowSearchQuery('');
  };

  const handleDuplicateInvoice = async (id: number) => {
    try {
      const invRes = await dbQuery('SELECT * FROM invoices WHERE id = $1', [id]);
      const itemsRes = await dbQuery('SELECT * FROM invoice_items WHERE invoice_id = $1', [id]);
      if (invRes.length > 0) {
        const inv = invRes[0];
        setCustomerId(inv.customer_id ? inv.customer_id.toString() : '');
        
        if (inv.customer_id) {
          const custRes = await dbQuery('SELECT * FROM customers WHERE id = $1', [inv.customer_id]);
          if (custRes.length > 0) {
            const c = custRes[0];
            setBillingName(c.name || '');
            setBillingPhone(c.mobile || '');
            setBillingAddress(c.address || '');
            setBillingGstin(c.gstin || '');
            setBillingState(c.state || '19-West Bengal');
          }
        } else {
          setBillingName('');
          setBillingPhone('');
          setBillingAddress('');
          setBillingGstin('');
          setBillingState('19-West Bengal');
        }

        setIsCreditSale(inv.status === 'unpaid');
        setPaymentMode(inv.payment_mode || 'Cash');
        setNotes(`Duplicate of ${inv.invoice_number}. ${inv.notes || ''}`);
        
        setItems(itemsRes.map((it: any) => ({
          product_id: it.product_id,
          name: it.name,
          quantity: it.quantity,
          price: it.price,
          gst_percentage: it.gst_percentage,
          gst_amount: it.gst_amount,
          discount: it.discount || 0,
          total: it.total,
          unit: it.unit || 'Nos',
          hsn_code: it.hsn_code || '85094010'
        })));
        
        alert(`Copied items and customer from ${inv.invoice_number} into draft.`);
      }
    } catch (err) {
      console.error('Failed to duplicate invoice:', err);
    }
  };

  // Calculations
  const calculatedItems = useMemo(() => {
    return items.map(it => {
      const qty = it.quantity || 0;
      const price = it.price || 0;
      const disc = it.discount || 0;
      const gst = it.gst_percentage || 0;
      
      const sub = (price * qty) - disc;
      const gstAmt = sub * (gst / 100);
      const total = sub + gstAmt;

      return {
        ...it,
        subtotal: sub,
        gst_amount: +gstAmt.toFixed(2),
        total: +total.toFixed(2)
      };
    });
  }, [items]);

  const grandSubtotal = calculatedItems.reduce((s, i) => s + i.subtotal, 0);
  const grandGst = calculatedItems.reduce((s, i) => s + i.gst_amount, 0);
  const grandTotalRaw = grandSubtotal + grandGst;
  const grandTotal = Math.round(grandTotalRaw);
  const roundOff = +(grandTotal - grandTotalRaw).toFixed(2);

  const totalQty = items.reduce((s, i) => s + (parseInt(i.quantity as any) || 0), 0);
  const totalDiscount = items.reduce((s, i) => s + (parseFloat(i.discount as any) || 0), 0);
  const totalGstAmount = calculatedItems.reduce((s, i) => s + i.gst_amount, 0);
  const totalAmountBeforeRound = calculatedItems.reduce((s, i) => s + i.total, 0);

  const handleSubmitInvoice = async () => {
    if (!customerId && !billingName) return alert('Please enter or select a customer name.');
    if (items.some(it => !it.name || it.price === 0)) {
      return alert('Line items must have a description and price.');
    }
    if (items.some(it => !it.hsn_code)) {
      return alert('All line items must have a valid HSN Code.');
    }

    // Verify stock availability
    for (const item of items) {
      if (item.product_id) {
        const prod = products.find(p => p.id === item.product_id);
        if (prod && prod.current_stock < item.quantity) {
          const proceed = confirm(`⚠️ Warning: "${prod.name}" has low stock. Available: ${prod.current_stock}. Proceed anyway?`);
          if (!proceed) return;
        }
      }
    }

    const finalTotalValue = roundOffEnabled ? grandTotal : +grandTotalRaw.toFixed(2);
    const status = isCreditSale ? 'unpaid' : 'paid';

    let finalCustomerId = customerId ? parseInt(customerId) : null;
    let selectedCustomer: any = {};

    try {
      // Auto-create or Auto-update customer inline
      if (!finalCustomerId && billingName) {
        const custRes = await dbRun(`
          INSERT INTO customers (name, mobile, address, gstin, state, email, outstanding_balance)
          VALUES ($1, $2, $3, $4, $5, '', 0)
        `, [billingName, billingPhone, billingAddress, billingGstin, billingState]);
        if (custRes.lastID) {
          finalCustomerId = custRes.lastID;
        }
      } else if (finalCustomerId) {
        await dbRun(`
          UPDATE customers 
          SET name = $1, mobile = $2, address = $3, gstin = $4, state = $5
          WHERE id = $6
        `, [billingName, billingPhone, billingAddress, billingGstin, billingState, finalCustomerId]);
      }

      if (finalCustomerId) {
        const custsRes = await dbQuery('SELECT * FROM customers WHERE id = $1', [finalCustomerId]);
        if (custsRes.length > 0) {
          selectedCustomer = custsRes[0];
        }
      }

      // 1. Save main invoice
      const dp = (paymentMode === 'Bajaj Finance' || paymentMode === 'Other Finance Partner') ? parseFloat(downPayment) || 0 : 0;
      const emi = (paymentMode === 'Bajaj Finance' || paymentMode === 'Other Finance Partner') ? parseFloat(emiAmount) || 0 : 0;
      const fc = paymentMode === 'Bajaj Finance' ? 'Bajaj Finance'
                 : paymentMode === 'Other Finance Partner' ? financeCompany
                 : null;

      const invoiceArgs = [
        invoiceNumber,
        finalCustomerId,
        invoiceDate,
        +grandSubtotal.toFixed(2),
        +grandGst.toFixed(2),
        0, // discount
        finalTotalValue,
        paymentMode,
        status,
        invoiceType,
        notes,
        gstIrn || null,
        einvoiceRef || null,
        ewayBillNo || null,
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
        // 2. Save items & deduct inventory stocks
        for (const item of calculatedItems) {
          await dbRun(`
            INSERT INTO invoice_items (invoice_id, product_id, name, quantity, price, gst_percentage, gst_amount, discount, total)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            invoiceId,
            item.product_id,
            item.name,
            item.quantity,
            item.price,
            item.gst_percentage,
            item.gst_amount,
            item.discount,
            item.total
          ]);

          if (item.product_id) {
            // Deduct stock
            await dbRun(`
              UPDATE products 
              SET current_stock = MAX(0, current_stock - $1), available_stock = MAX(0, available_stock - $1) 
              WHERE id = $2
            `, [item.quantity, item.product_id]);

            // Log stock movement
            await dbRun(`
              INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes)
              VALUES ($1, 'Stock Out', $2, $3, 'Invoice sale transaction')
            `, [item.product_id, item.quantity, invoiceNumber]);
          }
        }

        // 3. Update customer outstanding balance if sold on credit
        if (status === 'unpaid' && finalCustomerId) {
          await dbRun(`
            UPDATE customers 
            SET outstanding_balance = outstanding_balance + $1 
            WHERE id = $2
          `, [finalTotalValue, finalCustomerId]);
        }

        // 4. Create linked finance record if Bajaj Finance or Other Finance Partner is selected
        if (paymentMode === 'Bajaj Finance' || paymentMode === 'Other Finance Partner') {
          const productDetails = calculatedItems.map(it => `${it.name} (${it.quantity} ${it.unit})`).join(', ');
          const financedAmount = finalTotalValue - dp;
          const expectedPayout = financedAmount;
          const receivedPayout = 0;
          const pendingPayout = expectedPayout;
          const financeCo = fc || 'Bajaj Finance';

          await dbRun(`
            INSERT INTO finance_cases (invoice_number, customer_name, product_details, total_amount, down_payment, financed_amount, emi_amount, finance_company, expected_payout, received_payout, pending_payout)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            invoiceNumber,
            billingName || selectedCustomer.name || 'Walk-in Customer',
            productDetails,
            finalTotalValue,
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

      alert(`🎉 Invoice ${invoiceNumber} created successfully!`);
      localStorage.removeItem('em_billing_draft');

      // Auto-trigger PDF download
      await generatePDF(
        { invoice_number: invoiceNumber, date: invoiceDate, status, type: invoiceType, payment_mode: paymentMode, down_payment: dp, emi_amount: emi, finance_company: fc },
        selectedCustomer,
        calculatedItems
      );

      setPage('invoices');
    } catch (err: any) {
      alert(`Invoice generation failed: ${err.message || err}`);
    }
  };

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  };

  return (
    <div>
      {/* Draft recovery banner */}
      {draftDetected && (
        <div className="alert alert-yellow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
          <div>
            <strong>Draft Invoice Detected:</strong> You have an unsaved invoice draft from your previous session.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary btn-sm" onClick={handleRecoverDraft}>Recover Draft</button>
            <button className="btn btn-secondary btn-sm" onClick={handleDiscardDraft}>Discard</button>
          </div>
        </div>
      )}

      {/* Top Section - Single Screen Billing Header */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: '16px', border: '1px solid #cbd5e1' }}>
        {/* Toggle Sale vs Credit */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '15px' }}>Sale Type:</span>
            <div style={{ display: 'inline-flex', background: '#e2e8f0', borderRadius: '8px', padding: '3px' }}>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: !isCreditSale ? 'var(--brand)' : 'transparent',
                  color: !isCreditSale ? '#fff' : '#475569',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  setIsCreditSale(false);
                  setPaymentMode('Cash');
                }}
              >
                💵 Cash / Paid
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isCreditSale ? '#dc2626' : 'transparent',
                  color: isCreditSale ? '#fff' : '#475569',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  setIsCreditSale(true);
                  setPaymentMode('Credit Sale');
                }}
              >
                💳 Credit / Unpaid
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '13px', color: 'var(--gray)', fontWeight: 600 }}>Invoice No: <strong style={{ color: 'var(--brand)', fontSize: '14px' }}>{invoiceNumber}</strong></span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.5fr 1.5fr', gap: '16px', alignItems: 'start' }}>
          {/* Customer Columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ position: 'relative' }}>
              <label style={{ fontSize: '11px', fontWeight: 700 }}>Billing Name (Optional)</label>
              <input
                type="text"
                placeholder="Type to search or add customer..."
                value={billingName}
                onChange={e => {
                  setBillingName(e.target.value);
                  if (!e.target.value) {
                    setCustomerId('');
                  }
                }}
                onFocus={() => {
                  setShowNameSuggestions(true);
                  setShowPhoneSuggestions(false);
                }}
                onBlur={() => {
                  setTimeout(() => setShowNameSuggestions(false), 200);
                }}
                style={{ padding: '8px 10px', fontSize: '13px' }}
              />
              {/* Autocomplete Name Dropdown */}
              {showNameSuggestions && filteredCustomers.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', zIndex: 100, boxShadow: '0 4px 6px rgba(0,0,0,0.1)', maxHeight: '180px', overflowY: 'auto' }}>
                  {filteredCustomers.map(c => (
                    <div
                      key={c.id}
                      onMouseDown={() => selectCustomer(c)}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <strong>{c.name}</strong> {c.mobile ? `· ${c.mobile}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group" style={{ position: 'relative' }}>
              <label style={{ fontSize: '11px', fontWeight: 700 }}>Phone No.</label>
              <input
                type="text"
                placeholder="Search by phone..."
                value={billingPhone}
                onChange={e => {
                  setBillingPhone(e.target.value);
                  if (!e.target.value) {
                    setCustomerId('');
                  }
                }}
                onFocus={() => {
                  setShowPhoneSuggestions(true);
                  setShowNameSuggestions(false);
                }}
                onBlur={() => {
                  setTimeout(() => setShowPhoneSuggestions(false), 200);
                }}
                style={{ padding: '8px 10px', fontSize: '13px' }}
              />
              {/* Autocomplete Phone Dropdown */}
              {showPhoneSuggestions && filteredCustomers.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', zIndex: 100, boxShadow: '0 4px 6px rgba(0,0,0,0.1)', maxHeight: '180px', overflowY: 'auto' }}>
                  {filteredCustomers.map(c => (
                    <div
                      key={c.id}
                      onMouseDown={() => selectCustomer(c)}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <strong>{c.name}</strong> · {c.mobile}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '11px', fontWeight: 700 }}>Billing Address</label>
              <textarea
                placeholder="Enter customer address..."
                value={billingAddress}
                rows={1}
                onChange={e => setBillingAddress(e.target.value)}
                style={{ padding: '8px 10px', fontSize: '13px', resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Customer Metadata (GSTIN / State) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
            <div className="form-group">
              <label style={{ fontSize: '11px', fontWeight: 700 }}>GSTIN (Optional)</label>
              <input
                type="text"
                placeholder="e.g. 19ACRPD..."
                value={billingGstin}
                onChange={e => setBillingGstin(e.target.value)}
                style={{ padding: '8px 10px', fontSize: '13px' }}
              />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '11px', fontWeight: 700 }}>State of Supply</label>
              <select
                value={billingState}
                onChange={e => setBillingState(e.target.value)}
                style={{ padding: '8px', fontSize: '13px' }}
              >
                <option value="19-West Bengal">West Bengal</option>
                <option value="09-Uttar Pradesh">Uttar Pradesh</option>
                <option value="27-Maharashtra">Maharashtra</option>
                <option value="29-Karnataka">Karnataka</option>
                <option value="33-Tamil Nadu">Tamil Nadu</option>
                <option value="07-Delhi">Delhi</option>
                <option value="18-Assam">Assam</option>
                <option value="10-Bihar">Bihar</option>
                <option value="21-Odisha">Odisha</option>
              </select>
            </div>
          </div>

          {/* Invoice Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
            <div className="form-group">
              <label style={{ fontSize: '11px', fontWeight: 700 }}>Invoice Date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                style={{ padding: '7px', fontSize: '13px' }}
              />
            </div>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'end', gap: '8px', paddingBottom: '3px' }}>
              {customerId && (
                <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                  <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 700, background: 'var(--brand-light)', padding: '6px', borderRadius: '4px', flex: 1, textAlign: 'center' }}>
                    Linked Profile ✓
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setCustomerId('');
                      setBillingName('');
                      setBillingPhone('');
                      setBillingAddress('');
                      setBillingGstin('');
                    }}
                    title="Clear Selection"
                    style={{ padding: '4px 8px' }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Product Search Bar */}
      <div className="card" style={{ marginBottom: '16px', padding: '12px 20px', border: '1px solid #cbd5e1', position: 'relative' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🔍</span>
            <input 
              type="text" 
              ref={searchInputRef}
              placeholder="Scan barcode or type SKU / product name here... (Press F3 to focus)"
              value={productSearch}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              style={{ flex: 1, padding: '8px 12px', fontSize: '13.5px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        {/* Floating dropdown suggestions */}
        {filteredProducts.length > 0 && (
          <div 
            ref={dropdownRef}
            style={{
              position: 'absolute',
              top: '100%',
              left: '20px',
              right: '20px',
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: '0 0 8px 8px',
              zIndex: 150,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
              maxHeight: '200px',
              overflowY: 'auto'
            }}
          >
            {filteredProducts.map((p, idx) => (
              <div
                key={p.id}
                onMouseDown={() => {
                  addProductToLines(p);
                  setProductSearch('');
                }}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: searchIndex === idx ? 'var(--brand-light)' : 'transparent',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <strong style={{ fontSize: '13px' }}>{p.name}</strong>
                  <div style={{ fontSize: '10px', color: 'var(--gray)' }}>Barcode: {p.barcode} · SKU: {p.sku}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700 }}>{fmtCurrency(p.selling_price)}</div>
                  <div style={{ fontSize: '10px', color: p.current_stock <= 0 ? 'var(--red)' : 'var(--green)' }}>Stock: {p.current_stock}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Redesigned Product Grid Table */}
      <div className="card" style={{ padding: '0', marginBottom: '16px', border: '1px solid #cbd5e1', overflow: 'visible' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--dark-light)' }}>Product & Items Catalog</h4>
          <button className="btn btn-secondary btn-sm" onClick={addItemRow} style={{ padding: '6px 12px', borderRadius: '6px', fontWeight: 600 }}>+ Add Empty Row</button>
        </div>

        <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
          <table style={{ minWidth: '980px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ width: '40px', padding: '10px', fontSize: '11px', textAlign: 'center' }}>#</th>
                <th style={{ width: '320px', padding: '10px', fontSize: '11px' }}>ITEM DESCRIPTION</th>
                <th style={{ width: '100px', padding: '10px', fontSize: '11px', textAlign: 'center' }}>HSN CODE</th>
                <th style={{ width: '80px', padding: '10px', fontSize: '11px', textAlign: 'center' }}>QTY</th>
                <th style={{ width: '80px', padding: '10px', fontSize: '11px', textAlign: 'center' }}>UNIT</th>
                <th style={{ width: '110px', padding: '10px', fontSize: '11px', textAlign: 'right' }}>PRICE/UNIT (EXCL. GST)</th>
                <th style={{ width: '90px', padding: '10px', fontSize: '11px', textAlign: 'right' }}>DISCOUNT (₹)</th>
                <th style={{ width: '90px', padding: '10px', fontSize: '11px', textAlign: 'center' }}>GST TAX %</th>
                <th style={{ width: '120px', padding: '10px', fontSize: '11px', textAlign: 'right' }}>AMOUNT (INCL. GST)</th>
                <th style={{ width: '40px', padding: '10px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const calc = calculatedItems[idx];
                return (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    {/* Index */}
                    <td style={{ padding: '8px', textAlign: 'center', fontWeight: 600, color: 'var(--gray)', fontSize: '13px' }}>
                      {idx + 1}
                    </td>

                    {/* Item name / Autocomplete */}
                    <td style={{ padding: '8px', position: 'relative' }}>
                      <input
                        type="text"
                        placeholder="Type to search product or enter name..."
                        value={item.name}
                        onChange={e => {
                          updateItem(idx, 'name', e.target.value);
                          setRowSearchQuery(e.target.value);
                        }}
                        onFocus={() => {
                          setFocusedRowIdx(idx);
                          setRowSearchQuery(item.name);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            if (focusedRowIdx === idx) {
                              setFocusedRowIdx(null);
                            }
                          }, 200);
                        }}
                        style={{ width: '100%', padding: '6px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                      {/* Row Autocomplete Dropdown */}
                      {focusedRowIdx === idx && matchedRowProducts.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: '8px', right: '8px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', zIndex: 120, boxShadow: '0 4px 6px rgba(0,0,0,0.15)', maxHeight: '160px', overflowY: 'auto' }}>
                          {matchedRowProducts.map(p => (
                            <div
                              key={p.id}
                              onMouseDown={() => selectRowProduct(idx, p)}
                              style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              <span style={{ fontWeight: 600 }}>{p.name}</span>
                              <span style={{ color: 'var(--gray)' }}>{fmtCurrency(p.selling_price)} (Stock: {p.current_stock})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* HSN CODE */}
                    <td style={{ padding: '8px' }}>
                      <input
                        type="text"
                        value={item.hsn_code}
                        onChange={e => updateItem(idx, 'hsn_code', e.target.value)}
                        placeholder="HSN Code"
                        style={{ width: '100%', padding: '6px 8px', fontSize: '13px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </td>

                    {/* QTY */}
                    <td style={{ padding: '8px' }}>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                        style={{ width: '100%', padding: '6px 8px', fontSize: '13px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </td>

                    {/* UNIT */}
                    <td style={{ padding: '8px' }}>
                      <select
                        value={item.unit}
                        onChange={e => updateItem(idx, 'unit', e.target.value)}
                        style={{ width: '100%', padding: '6px 4px', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      >
                        {['Nos', 'Kgs', 'Ltrs', 'Boxes', 'Pkts'].map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </td>

                    {/* PRICE/UNIT */}
                    <td style={{ padding: '8px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={item.price}
                        onChange={e => updateItem(idx, 'price', parseFloat(e.target.value) || 0)}
                        style={{ width: '100%', padding: '6px 8px', fontSize: '13px', textAlign: 'right', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </td>

                    {/* DISCOUNT */}
                    <td style={{ padding: '8px' }}>
                      <input
                        type="number"
                        value={item.discount}
                        onChange={e => updateItem(idx, 'discount', parseFloat(e.target.value) || 0)}
                        style={{ width: '100%', padding: '6px 8px', fontSize: '13px', textAlign: 'right', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </td>

                    {/* GST TAX % */}
                    <td style={{ padding: '8px' }}>
                      <select
                        value={item.gst_percentage}
                        onChange={e => updateItem(idx, 'gst_percentage', parseInt(e.target.value) || 0)}
                        style={{ width: '100%', padding: '6px 4px', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      >
                        {[0, 5, 12, 18, 28].map(g => (
                          <option key={g} value={g}>{g}%</option>
                        ))}
                      </select>
                    </td>

                    {/* AMOUNT */}
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontSize: '13.5px', color: '#1e293b' }}>
                      {fmtCurrency(calc?.total || 0)}
                    </td>

                    {/* Actions Delete */}
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: '16px', cursor: 'pointer', padding: '4px' }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Table Footer - Column aligned totals */}
            <tfoot>
              <tr style={{ background: '#f8fafc', borderTop: '2px solid #cbd5e1', borderBottom: '1px solid #cbd5e1' }}>
                <td colSpan={3} style={{ padding: '10px 16px', fontWeight: 700, fontSize: '12px', color: 'var(--gray)', textTransform: 'uppercase', textAlign: 'right' }}>
                  TOTALS:
                </td>
                <td style={{ padding: '10px', fontWeight: 700, fontSize: '13.5px', textAlign: 'center', color: 'var(--dark)' }}>
                  {totalQty}
                </td>
                <td></td>
                <td></td>
                <td style={{ padding: '10px', fontWeight: 700, fontSize: '13.5px', textAlign: 'right', color: 'var(--dark)' }}>
                  {fmtCurrency(totalDiscount)}
                </td>
                <td style={{ padding: '10px', fontWeight: 700, fontSize: '11.5px', textAlign: 'center', color: 'var(--gray)' }}>
                  Tax: {fmtCurrency(totalGstAmount)}
                </td>
                <td style={{ padding: '10px', fontWeight: 800, fontSize: '14.5px', textAlign: 'right', color: 'var(--brand)' }}>
                  {fmtCurrency(totalAmountBeforeRound)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Bottom Layout - Totals, Notes, Round Off & Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'start', marginTop: '16px' }}>
        
        {/* Bottom Left: Notes, Settlement & Compliance */}
        <div>
          <div className="card" style={{ padding: '18px 20px', marginBottom: '16px', border: '1px solid #cbd5e1' }}>
            <div style={{ display: 'grid', gridTemplateColumns: !isCreditSale ? '1fr 1.2fr' : '1fr', gap: '16px', marginBottom: '12px' }}>
              
              {!isCreditSale ? (
                <div className="form-group">
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>Settlement Mode</label>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} style={{ padding: '8px', fontSize: '13px' }}>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Bajaj Finance">Bajaj Finance</option>
                    <option value="Other Finance Partner">Other Finance Partner</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>Settlement Mode</label>
                  <input type="text" value="Credit Sale" disabled style={{ padding: '8px', fontSize: '13px', background: '#f1f5f9' }} />
                </div>
              )}

              <div className="form-group">
                <label style={{ fontSize: '11px', fontWeight: 700 }}>Notes / Description</label>
                <textarea 
                  value={notes} 
                  rows={2} 
                  onChange={e => setNotes(e.target.value)} 
                  placeholder="Include billing references, logistics details, or special terms..."
                  style={{ padding: '8px 10px', fontSize: '13px' }}
                />
              </div>

            </div>

            {/* Compact Bajaj Finance / Other Finance Partner Fields */}
            {!isCreditSale && (paymentMode === 'Bajaj Finance' || paymentMode === 'Other Finance Partner') && (
              <div style={{ display: 'grid', gridTemplateColumns: paymentMode === 'Other Finance Partner' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '12px', background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>Down Payment (₹)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Down payment amount..."
                    value={downPayment}
                    onChange={e => setDownPayment(e.target.value)}
                    style={{ padding: '7px 10px', fontSize: '13px' }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>EMI Amount (₹ / Month)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Monthly EMI..."
                    value={emiAmount}
                    onChange={e => setEmiAmount(e.target.value)}
                    style={{ padding: '7px 10px', fontSize: '13px' }}
                  />
                </div>
                {paymentMode === 'Other Finance Partner' && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '11px', fontWeight: 700 }}>Finance Partner</label>
                    <select
                      value={financeCompany}
                      onChange={e => setFinanceCompany(e.target.value)}
                      style={{ padding: '7px', fontSize: '13px' }}
                    >
                      {financePartners.filter(p => p !== 'Bajaj Finance').map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Collapsible compliance fields (kept but hidden in details tag) */}
            <details style={{ marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
              <summary style={{ fontWeight: 600, fontSize: '12px', cursor: 'pointer', color: 'var(--gray)' }}>
                🛡️ GST Compliance Fields (Optional)
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginTop: '12px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '10px' }}>GST IRN</label>
                  <input type="text" placeholder="IRN hash..." value={gstIrn} onChange={e => setGstIrn(e.target.value)} style={{ padding: '6px', fontSize: '12px' }} />
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '10px' }}>E-Invoice Ref</label>
                  <input type="text" placeholder="Reference..." value={einvoiceRef} onChange={e => setEinvoiceRef(e.target.value)} style={{ padding: '6px', fontSize: '12px' }} />
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '10px' }}>E-Way Bill No</label>
                  <input type="text" placeholder="E-way bill number..." value={ewayBillNo} onChange={e => setEwayBillNo(e.target.value)} style={{ padding: '6px', fontSize: '12px' }} />
                </div>
              </div>
            </details>
          </div>

          {/* Collapsible Recent Invoices drawer (kept but hidden) */}
          <details className="card" style={{ padding: '12px 18px', border: '1px solid #cbd5e1' }}>
            <summary style={{ fontWeight: 600, fontSize: '12.5px', cursor: 'pointer', color: 'var(--gray)' }}>
              📚 Recent Invoices (Duplicate options)
            </summary>
            {recentInvoices.length === 0 ? (
              <p style={{ color: 'var(--gray)', fontSize: '11px', padding: '8px 0' }}>No recent invoices.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                {recentInvoices.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: '#f8fafc', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px' }}>
                      <strong style={{ color: 'var(--brand)' }}>{inv.invoice_number}</strong> · <span style={{ fontWeight: 600 }}>{inv.customer_name}</span> · <span style={{ color: 'var(--gray)' }}>{fmtCurrency(inv.total)}</span>
                    </div>
                    <button 
                      type="button"
                      className="btn btn-secondary btn-sm" 
                      style={{ padding: '3px 8px', fontSize: '10.5px', borderRadius: '4px' }} 
                      onClick={() => handleDuplicateInvoice(inv.id)}
                    >
                      🔁 Duplicate
                    </button>
                  </div>
                ))}
              </div>
            )}
          </details>
        </div>

        {/* Bottom Right: Round Off, Totals & Save Actions */}
        <div className="card" style={{ padding: '24px', border: '1px solid #cbd5e1' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', color: 'var(--dark-light)', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>Valuation summary</h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--gray)' }}>Taxable Subtotal (excl. Tax)</span>
              <strong>{fmtCurrency(grandSubtotal)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--gray)' }}>GST Tax Amount</span>
              <strong>{fmtCurrency(grandGst)}</strong>
            </div>

            {/* Round Off Toggle Row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px dashed #cbd5e1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0, fontWeight: 600 }}>
                <input 
                  type="checkbox" 
                  checked={roundOffEnabled} 
                  onChange={e => setRoundOffEnabled(e.target.checked)} 
                />
                Auto Round Off
              </label>
              <strong>
                {roundOffEnabled ? (roundOff >= 0 ? '+' : '') + fmtCurrency(roundOff) : 'Rs. 0.00'}
              </strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', borderTop: '2px solid #cbd5e1', paddingTop: '16px', marginTop: '4px' }}>
              <span style={{ fontWeight: 700, color: 'var(--dark)' }}>Grand Total</span>
              <strong style={{ color: 'var(--brand)', fontSize: '20px' }}>
                {fmtCurrency(roundOffEnabled ? grandTotal : +grandTotalRaw.toFixed(2))}
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={() => setPage('invoices')} 
              style={{ flex: 1, justifyContent: 'center', padding: '12px', fontSize: '14.5px', borderRadius: '8px', fontWeight: 600 }}
            >
              ✕ Discard
            </button>
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={handleSubmitInvoice} 
              style={{ flex: 2, justifyContent: 'center', padding: '12px', fontSize: '14.5px', borderRadius: '8px', fontWeight: 700, background: 'var(--brand)' }}
            >
              🧾 Save & Print PDF
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
