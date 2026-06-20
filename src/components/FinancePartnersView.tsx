'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

interface FinanceCase {
  id: number;
  invoice_number: string;
  customer_name: string;
  product_details: string;
  total_amount: number;
  down_payment: number;
  financed_amount: number;
  emi_amount: number;
  finance_company: string;
  expected_payout: number;
  received_payout: number;
  pending_payout: number;
  created_at: string;
}

interface PartnerSummary {
  finance_company: string;
  case_count: number;
  total_sales: number;
  total_financed: number;
  total_expected: number;
  total_received: number;
  total_pending: number;
}

interface PayoutHistory {
  id: number;
  case_id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  received_date: string;
  reference: string;
}

const OCR_TEMPLATES = [
  {
    id: 'bajaj-tv',
    label: "Bajaj Finance - LED TV Purchase",
    text: `JIYA'S ARCADE - RETAIL TAX INVOICE
Invoice No: INV-OCR-8821
Date: 2026-06-05
Customer: Devendra Prasad
Phone: 9832047812
Item: Sony Bravia LED TV 43"
Price: ₹35,000
Taxes (18%): ₹6,300
Grand Total: ₹41,300
Payment Method: Bajaj Finance
Down Payment: ₹5,300
EMI: ₹3,000 / Month for 12 Months
Finance Company Name: Bajaj Finance`
  },
  {
    id: 'hdb-ac',
    label: "HDB Finance - Split AC Purchase",
    text: `JIYA'S ARCADE - RETAIL TAX INVOICE
Invoice No: INV-OCR-4029
Date: 2026-06-05
Customer: Riya Sen
Phone: 9002233445
Item: Voltas Split AC 1.5 Ton
Price: ₹42,000
Taxes (18%): ₹7,560
Grand Total: ₹49,560
Payment Method: Other Finance Partner
Down Payment: ₹9,560
EMI: ₹4,000 / Month for 10 Months
Finance Company Name: HDB Finance`
  },
  {
    id: 'homecredit-fridge',
    label: "Home Credit - Refrigerator Purchase",
    text: `JIYA'S ARCADE - RETAIL TAX INVOICE
Invoice No: INV-OCR-5510
Date: 2026-06-05
Customer: Bikram Ghosh
Phone: 9474720911
Item: Samsung Double Door Refrigerator
Price: ₹22,000
Taxes (18%): ₹3,960
Grand Total: ₹25,960
Payment Method: Other Finance Partner
Down Payment: ₹3,960
EMI: ₹2,200 / Month for 10 Months
Finance Company Name: Home Credit`
  }
];

export default function FinancePartnersView() {
  const [activeTab, setActiveTab] = useState<'overview' | 'cases' | 'payouts' | 'ocr' | 'partners'>('overview');
  const [loading, setLoading] = useState(true);

  // Data States
  const [cases, setCases] = useState<FinanceCase[]>([]);
  const [partnerSummaries, setPartnerSummaries] = useState<PartnerSummary[]>([]);
  const [payoutsHistory, setPayoutsHistory] = useState<PayoutHistory[]>([]);
  const [partnersList, setPartnersList] = useState<string[]>([]);
  const [overviewStats, setOverviewStats] = useState({
    totalFinanced: 0,
    totalExpected: 0,
    totalReceived: 0,
    totalPending: 0
  });

  // Dialog States
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [payoutAmt, setPayoutAmt] = useState('');
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().split('T')[0]);
  const [payoutRef, setPayoutRef] = useState('');

  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState('');

  // OCR Imports State
  const [selectedTemplate, setSelectedTemplate] = useState('bajaj-tv');
  const [ocrRawText, setOcrRawText] = useState(OCR_TEMPLATES[0].text);
  const [ocrLogs, setOcrLogs] = useState<string[]>([]);
  const [ocrResults, setOcrResults] = useState<any>(null);

  // Filters
  const [caseSearch, setCaseSearch] = useState('');
  const [casePartnerFilter, setCasePartnerFilter] = useState('');

  useEffect(() => {
    loadFinanceData();
  }, [activeTab]);

  const loadFinanceData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Overview Stats
      const statRes = await dbQuery(`
        SELECT SUM(financed_amount) as total_financed,
               SUM(expected_payout) as total_expected,
               SUM(received_payout) as total_received,
               SUM(pending_payout) as total_pending
        FROM finance_cases
      `);
      if (statRes && statRes.length > 0) {
        setOverviewStats({
          totalFinanced: statRes[0].total_financed || 0,
          totalExpected: statRes[0].total_expected || 0,
          totalReceived: statRes[0].total_received || 0,
          totalPending: statRes[0].total_pending || 0
        });
      }

      // 2. Fetch Partner summaries
      const summaries = await dbQuery(`
        SELECT finance_company,
               COUNT(*) as case_count,
               SUM(total_amount) as total_sales,
               SUM(financed_amount) as total_financed,
               SUM(expected_payout) as total_expected,
               SUM(received_payout) as total_received,
               SUM(pending_payout) as total_pending
        FROM finance_cases
        GROUP BY finance_company
      `);
      setPartnerSummaries(summaries);

      // 3. Fetch Case registry
      const caseList = await dbQuery('SELECT * FROM finance_cases ORDER BY id DESC');
      setCases(caseList);

      // 4. Fetch Payout history records
      const histories = await dbQuery(`
        SELECT h.*, c.customer_name, c.invoice_number
        FROM finance_payout_history h
        JOIN finance_cases c ON h.case_id = c.id
        ORDER BY h.id DESC LIMIT 50
      `);
      setPayoutsHistory(histories);

      // 5. Fetch registered partner companies
      const partners = await dbQuery('SELECT name FROM finance_partners ORDER BY name ASC');
      setPartnersList(partners.map((p: any) => p.name));

    } catch (err) {
      console.error('Failed to load finance partners records:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const tmpl = OCR_TEMPLATES.find(t => t.id === id);
    if (tmpl) {
      setOcrRawText(tmpl.text);
      setOcrResults(null);
      setOcrLogs([]);
    }
  };

  const handleRunOcr = () => {
    const logs: string[] = [];
    logs.push("⏳ Starting simulated Optical Character Recognition (OCR) scan...");

    // Basic regex parser
    const invMatch = ocrRawText.match(/Invoice\s*No:\s*([A-Za-z0-9-]+)/i);
    const custMatch = ocrRawText.match(/Customer:\s*([^\r\n]+)/i);
    const phoneMatch = ocrRawText.match(/Phone:\s*(\d{10})/i);
    const itemMatch = ocrRawText.match(/Item:\s*([^\r\n]+)/i);
    const totalMatch = ocrRawText.match(/Grand\s*Total:\s*₹?\s*([\d,]+)/i);
    const dpMatch = ocrRawText.match(/Down\s*Payment:\s*₹?\s*([\d,]+)/i);
    const emiMatch = ocrRawText.match(/EMI:\s*₹?\s*([\d,]+)/i);
    const partnerMatch = ocrRawText.match(/Finance\s*Company\s*Name:\s*([^\r\n]+)/i);

    const parsed = {
      invoiceNumber: invMatch ? invMatch[1].trim() : '',
      customerName: custMatch ? custMatch[1].trim() : '',
      customerPhone: phoneMatch ? phoneMatch[1].trim() : '',
      itemDescription: itemMatch ? itemMatch[1].trim() : '',
      totalAmount: totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) || 0 : 0,
      downPayment: dpMatch ? parseInt(dpMatch[1].replace(/,/g, '')) || 0 : 0,
      emiAmount: emiMatch ? parseInt(emiMatch[1].replace(/,/g, '')) || 0 : 0,
      financeCompany: partnerMatch ? partnerMatch[1].trim() : ''
    };

    logs.push(`🔍 Detecting receipt values...`);
    if (parsed.invoiceNumber) logs.push(`✓ Invoice Number Found: "${parsed.invoiceNumber}"`);
    else logs.push(`❌ Error: Invoice Number not detected.`);

    if (parsed.customerName) logs.push(`✓ Customer Name Found: "${parsed.customerName}"`);
    if (parsed.financeCompany) logs.push(`✓ Finance Partner Found: "${parsed.financeCompany}"`);
    if (parsed.totalAmount) logs.push(`✓ Invoice Grand Total detected: ₹${parsed.totalAmount}`);
    if (parsed.downPayment) logs.push(`✓ Down Payment detected: ₹${parsed.downPayment}`);
    if (parsed.emiAmount) logs.push(`✓ EMI Amount detected: ₹${parsed.emiAmount}/Month`);

    const hasErrors = !parsed.invoiceNumber || !parsed.customerName || !parsed.financeCompany || !parsed.totalAmount;
    if (hasErrors) {
      logs.push(`⚠️ OCR Parsing failed. Please ensure template contains valid Invoice, Customer, Total, and Finance Partner fields.`);
      setOcrResults(null);
    } else {
      logs.push(`🎉 OCR scan succeeded! Click "Import Document" below to save invoice and link case.`);
      setOcrResults(parsed);
    }
    setOcrLogs(logs);
  };

  const handleImportOcr = async () => {
    if (!ocrResults) return;
    try {
      // 1. Create customer if not exists
      let customerId = null;
      const existCust = await dbQuery('SELECT id FROM customers WHERE mobile = $1', [ocrResults.customerPhone]);
      if (existCust && existCust.length > 0) {
        customerId = existCust[0].id;
      } else {
        const insCust = await dbRun(`
          INSERT INTO customers (name, mobile, address, outstanding_balance, state) 
          VALUES ($1, $2, 'Imported from OCR', 0, '19-West Bengal')
        `, [ocrResults.customerName, ocrResults.customerPhone || '0000000000']);
        customerId = insCust.lastID;
      }

      // Check if invoice already exists
      const existInv = await dbQuery('SELECT id FROM invoices WHERE invoice_number = $1', [ocrResults.invoiceNumber]);
      if (existInv && existInv.length > 0) {
        return alert(`Invoice "${ocrResults.invoiceNumber}" has already been imported!`);
      }

      // 2. Save mock product if not exists
      let productId = null;
      const existProd = await dbQuery('SELECT id FROM products WHERE name = $1', [ocrResults.itemDescription]);
      if (existProd && existProd.length > 0) {
        productId = existProd[0].id;
      } else {
        const insProd = await dbRun(`
          INSERT INTO products (name, sku, category, unit, hsn_code, gst_percentage, selling_price, current_stock, available_stock)
          VALUES ($1, $2, 'OCR Import', 'Nos', '85287217', 18, $3, 10, 10)
        `, [ocrResults.itemDescription, `SKU-OCR-${Date.now()}`, ocrResults.totalAmount]);
        productId = insProd.lastID;
      }

      // Calculate Subtotal & Tax values
      const taxRate = 0.18;
      const basePrice = Math.round(ocrResults.totalAmount / (1 + taxRate));
      const taxAmt = ocrResults.totalAmount - basePrice;

      // 3. Save main invoice
      const invoiceDate = new Date().toISOString().split('T')[0];
      const pmMode = ocrResults.financeCompany === 'Bajaj Finance' ? 'Bajaj Finance' : 'Other Finance Partner';
      
      const invRes = await dbRun(`
        INSERT INTO invoices (invoice_number, customer_id, date, subtotal, gst_amount, discount, total, payment_mode, status, type, notes, down_payment, emi_amount, finance_company)
        VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'paid', 'Tax Invoice', 'Imported via Receipt OCR', $8, $9, $10)
      `, [
        ocrResults.invoiceNumber,
        customerId,
        invoiceDate,
        basePrice,
        taxAmt,
        ocrResults.totalAmount,
        pmMode,
        ocrResults.downPayment,
        ocrResults.emiAmount,
        ocrResults.financeCompany
      ]);

      const invoiceId = invRes.lastID;

      if (invoiceId) {
        // Save items
        await dbRun(`
          INSERT INTO invoice_items (invoice_id, product_id, name, quantity, price, gst_percentage, gst_amount, total)
          VALUES ($1, $2, $3, 1, $4, 18, $5, $6)
        `, [
          invoiceId,
          productId,
          ocrResults.itemDescription,
          basePrice,
          taxAmt,
          ocrResults.totalAmount
        ]);

        // 4. Create Linked Finance Case
        const financedAmount = ocrResults.totalAmount - ocrResults.downPayment;
        await dbRun(`
          INSERT INTO finance_cases (invoice_number, customer_name, product_details, total_amount, down_payment, financed_amount, emi_amount, finance_company, expected_payout, received_payout, pending_payout)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $9)
        `, [
          ocrResults.invoiceNumber,
          ocrResults.customerName,
          `${ocrResults.itemDescription} (1 Nos)`,
          ocrResults.totalAmount,
          ocrResults.downPayment,
          financedAmount,
          ocrResults.emiAmount,
          ocrResults.financeCompany,
          financedAmount
        ]);
      }

      alert(`🎉 OCR Import Successful!\nInvoice "${ocrResults.invoiceNumber}" saved and case linked.`);
      setOcrResults(null);
      setOcrLogs([]);
      setActiveTab('cases');
    } catch (err: any) {
      alert(`Import failed: ${err.message || err}`);
    }
  };

  const handleRecordPayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !payoutAmt) return alert('Case and Payout Amount are required.');

    const amt = parseFloat(payoutAmt);
    if (isNaN(amt) || amt <= 0) return alert('Enter a valid payout amount.');

    try {
      const caseRes = await dbQuery('SELECT pending_payout, expected_payout, received_payout FROM finance_cases WHERE id = $1', [selectedCaseId]);
      if (caseRes.length === 0) return alert('Case not found.');

      const currentPending = caseRes[0].pending_payout;
      if (amt > currentPending) {
        const force = confirm(`⚠️ Warning: Payout amount (₹${amt}) exceeds the current pending payout balance (₹${currentPending}). Record anyway?`);
        if (!force) return;
      }

      // 1. Insert history payout transaction
      await dbRun(`
        INSERT INTO finance_payout_history (case_id, amount, received_date, reference)
        VALUES ($1, $2, $3, $4)
      `, [selectedCaseId, amt, payoutDate, payoutRef || 'N/A']);

      // 2. Deduct pending payout in case
      await dbRun(`
        UPDATE finance_cases
        SET received_payout = received_payout + $1,
            pending_payout = MAX(0, pending_payout - $1),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [amt, selectedCaseId]);

      alert('✅ Payout transaction logged successfully!');
      setShowPayoutModal(false);
      setSelectedCaseId('');
      setPayoutAmt('');
      setPayoutRef('');
      loadFinanceData();
    } catch (err: any) {
      alert(`Failed to record settlement: ${err.message || err}`);
    }
  };

  const handleAddPartnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartnerName.trim()) return;

    try {
      await dbRun('INSERT INTO finance_partners (name) VALUES ($1)', [newPartnerName.trim()]);
      alert(`✅ Finance company "${newPartnerName}" registered!`);
      setNewPartnerName('');
      setShowAddPartnerModal(false);
      loadFinanceData();
    } catch (err: any) {
      alert(`Registration failed: ${err.message || err}`);
    }
  };

  const filteredCases = cases.filter(c => {
    const matchesSearch = c.invoice_number.toLowerCase().includes(caseSearch.toLowerCase()) ||
                          c.customer_name.toLowerCase().includes(caseSearch.toLowerCase()) ||
                          c.product_details.toLowerCase().includes(caseSearch.toLowerCase());
    const matchesPartner = !casePartnerFilter || c.finance_company === casePartnerFilter;
    return matchesSearch && matchesPartner;
  });

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  };

  return (
    <div>
      {/* Navigation tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
        <button className={`btn ${activeTab === 'overview' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('overview')}>📊 Overview & Payouts</button>
        <button className={`btn ${activeTab === 'cases' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('cases')}>👥 Customer Cases ({filteredCases.length})</button>
        <button className={`btn ${activeTab === 'payouts' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('payouts')}>💸 Payout History</button>
        <button className={`btn ${activeTab === 'ocr' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('ocr')}>🔍 Receipt OCR Import</button>
        <button className={`btn ${activeTab === 'partners' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('partners')}>🏢 Finance Companies</button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '30px', textAlign: 'center' }}>Compiling finance records...</div>
      ) : (
        <>
          {/* Tab 1: Overview Dashboard */}
          {activeTab === 'overview' && (
            <div>
              {/* Stat Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="stat-card blue" style={{ borderLeft: '4px solid var(--brand)' }}>
                  <div className="label">Total Financed Sales</div>
                  <div className="value" style={{ color: 'var(--brand)' }}>{fmtCurrency(overviewStats.totalFinanced)}</div>
                  <div className="sub">Total principal amount financed</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '4px solid #8b5cf6', background: '#f5f3ff' }}>
                  <div className="label" style={{ color: '#6d28d9' }}>Expected Payouts</div>
                  <div className="value" style={{ color: '#6d28d9' }}>{fmtCurrency(overviewStats.totalExpected)}</div>
                  <div className="sub">Amounts claimable from partners</div>
                </div>
                <div className="stat-card green" style={{ borderLeft: '4px solid var(--green)' }}>
                  <div className="label">Received Payouts</div>
                  <div className="value">{fmtCurrency(overviewStats.totalReceived)}</div>
                  <div className="sub">Payout settlements received</div>
                </div>
                <div className="stat-card red" style={{ borderLeft: '4px solid var(--red)' }}>
                  <div className="label">Pending Payout Amount</div>
                  <div className="value">{fmtCurrency(overviewStats.totalPending)}</div>
                  <div className="sub">Internal outstanding balance</div>
                </div>
              </div>

              {/* Partner Summary Table */}
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ fontSize: '15px', fontWeight: 700 }}>Summary by Finance Partner</h4>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowPayoutModal(true)}>Record Payout Settlement</button>
              </div>
              <div className="card" style={{ padding: 0, marginBottom: '24px' }}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th>Finance Company</th>
                        <th style={{ textAlign: 'center' }}>Total Cases</th>
                        <th style={{ textAlign: 'right' }}>Financed Sales</th>
                        <th style={{ textAlign: 'right' }}>Expected Payout</th>
                        <th style={{ textAlign: 'right' }}>Received Payout</th>
                        <th style={{ textAlign: 'right' }}>Pending Payout (Outstanding)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerSummaries.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '16px', color: 'var(--gray)' }}>No financed cases found.</td></tr>
                      ) : partnerSummaries.map((p, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{p.finance_company}</td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{p.case_count} cases</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(p.total_financed)}</td>
                          <td style={{ textAlign: 'right', color: '#6d28d9', fontWeight: 600 }}>{fmtCurrency(p.total_expected)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{fmtCurrency(p.total_received)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--red)', fontWeight: 700 }}>{fmtCurrency(p.total_pending)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Case Registry */}
          {activeTab === 'cases' && (
            <div>
              {/* Filters */}
              <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: 2, minWidth: '220px', margin: 0 }}>
                    <input
                      type="text"
                      placeholder="Search cases by customer name, products, invoice number..."
                      value={caseSearch}
                      onChange={e => setCaseSearch(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                    <select
                      value={casePartnerFilter}
                      onChange={e => setCasePartnerFilter(e.target.value)}
                      style={{ padding: '8px', fontSize: '13px' }}
                    >
                      <option value="">All Finance Companies</option>
                      {partnersList.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-primary" onClick={() => setShowPayoutModal(true)}>+ Record Settlement</button>
                </div>
              </div>

              {/* Case Registry Grid */}
              <div className="card" style={{ padding: 0 }}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th>Invoice #</th>
                        <th>Customer</th>
                        <th>Product Details</th>
                        <th>Finance Co.</th>
                        <th style={{ textAlign: 'right' }}>Total invoice</th>
                        <th style={{ textAlign: 'right' }}>Down Payment</th>
                        <th style={{ textAlign: 'right' }}>Financed Amt</th>
                        <th style={{ textAlign: 'right' }}>EMI Amt</th>
                        <th style={{ textAlign: 'right' }}>Received Payout</th>
                        <th style={{ textAlign: 'right' }}>Pending Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCases.length === 0 ? (
                        <tr><td colSpan={10} style={{ textAlign: 'center', padding: '20px', color: 'var(--gray)' }}>No customer cases found.</td></tr>
                      ) : filteredCases.map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 700, color: 'var(--brand)' }}>{c.invoice_number}</td>
                          <td style={{ fontWeight: 600 }}>{c.customer_name}</td>
                          <td style={{ fontSize: '11px', color: '#475569' }}>{c.product_details}</td>
                          <td><span className="badge badge-gray">{c.finance_company}</span></td>
                          <td style={{ textAlign: 'right' }}>{fmtCurrency(c.total_amount)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--gray)' }}>{fmtCurrency(c.down_payment)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(c.financed_amount)}</td>
                          <td style={{ textAlign: 'right', fontSize: '12px' }}>{fmtCurrency(c.emi_amount)}/Mo</td>
                          <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtCurrency(c.received_payout)}</td>
                          <td style={{ textAlign: 'right', color: c.pending_payout > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                            {c.pending_payout > 0 ? fmtCurrency(c.pending_payout) : 'Settled ✓'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Payout History */}
          {activeTab === 'payouts' && (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th>Date Received</th>
                      <th>Invoice Number</th>
                      <th>Customer Name</th>
                      <th>Settled Amount</th>
                      <th>Reference / Txn ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutsHistory.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray)' }}>No payout settlements recorded.</td></tr>
                    ) : payoutsHistory.map(h => (
                      <tr key={h.id}>
                        <td style={{ fontWeight: 600 }}>{h.received_date}</td>
                        <td style={{ fontWeight: 700, color: 'var(--brand)' }}>{h.invoice_number}</td>
                        <td>{h.customer_name}</td>
                        <td style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtCurrency(h.amount)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{h.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 4: Mock OCR Receipt Scanner */}
          {activeTab === 'ocr' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Left Column: Input Template */}
              <div className="card">
                <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px' }}>Select Mock Receipt OCR Template</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                  {OCR_TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      className={`btn btn-sm ${selectedTemplate === t.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleTemplateChange(t.id)}
                    >
                      📄 {t.label}
                    </button>
                  ))}
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>Scanned OCR Text Output</label>
                  <textarea
                    rows={12}
                    value={ocrRawText}
                    onChange={e => setOcrRawText(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: '12px', padding: '10px', width: '100%', resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setOcrRawText('')}>Clear Text</button>
                  <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleRunOcr}>Run OCR Scan 🔍</button>
                </div>
              </div>

              {/* Right Column: Parsing Logs & Save Action */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>OCR Scanned Results & Parsing Log</h4>
                
                {/* Console Logs */}
                <div style={{ flex: 1, minHeight: '160px', background: '#0f172a', color: '#38bdf8', padding: '12px 16px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '11.5px', overflowY: 'auto', marginBottom: '16px' }}>
                  {ocrLogs.length === 0 ? (
                    <div style={{ color: '#64748b' }}>Console idle. Select a template and click "Run OCR Scan" to begin.</div>
                  ) : ocrLogs.map((l, i) => (
                    <div key={i} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>{l}</div>
                  ))}
                </div>

                {ocrResults && (
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                    <h5 style={{ fontWeight: 700, fontSize: '13px', color: '#1e40af', borderBottom: '1px solid #dbeafe', paddingBottom: '6px', marginBottom: '10px' }}>
                      Import Invoice Data Draft
                    </h5>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', fontSize: '11.5px', color: '#1e293b' }}>
                      <div><strong>Invoice #:</strong> {ocrResults.invoiceNumber}</div>
                      <div><strong>Customer Name:</strong> {ocrResults.customerName}</div>
                      <div><strong>Phone No.:</strong> {ocrResults.customerPhone}</div>
                      <div><strong>Item details:</strong> {ocrResults.itemDescription}</div>
                      <div><strong>Grand Total:</strong> {fmtCurrency(ocrResults.totalAmount)}</div>
                      <div><strong>Down Payment:</strong> {fmtCurrency(ocrResults.downPayment)}</div>
                      <div><strong>EMI Amount:</strong> {fmtCurrency(ocrResults.emiAmount)}/Mo</div>
                      <div><strong>Finance Co.:</strong> {ocrResults.financeCompany}</div>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleImportOcr}
                      style={{ width: '100%', marginTop: '14px', background: 'var(--brand)', fontWeight: 700 }}
                    >
                      Import Scanned Invoice to Registry ✓
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 5: Finance Companies (Add custom partners) */}
          {activeTab === 'partners' && (
            <div>
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ fontSize: '15px', fontWeight: 700 }}>Registered Finance Partners</h4>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddPartnerModal(true)}>+ Register New Company</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {partnersList.map((p, idx) => {
                  const summary = partnerSummaries.find(s => s.finance_company === p);
                  return (
                    <div key={idx} className="card" style={{ border: '1px solid #e2e8f0', padding: '16px 20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--dark)' }}>🏢 {p}</span>
                        <span className="badge badge-gray" style={{ fontSize: '10px' }}>
                          {summary ? `${summary.case_count} Cases` : '0 Cases'}
                        </span>
                      </div>
                      {summary ? (
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px', color: '#475569' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Financed:</span>
                            <strong>{fmtCurrency(summary.total_financed)}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Settled:</span>
                            <strong style={{ color: 'var(--green)' }}>{fmtCurrency(summary.total_received)}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #e2e8f0', paddingTop: '4px', marginTop: '2px' }}>
                            <span style={{ fontWeight: 600 }}>Outstanding Pending:</span>
                            <strong style={{ color: 'var(--red)' }}>{fmtCurrency(summary.total_pending)}</strong>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: 'var(--gray)', fontStyle: 'italic', marginTop: '6px' }}>
                          No financed invoices recorded yet.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Record Payout Settlement Modal */}
      {showPayoutModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPayoutModal(false)}>
          <div className="modal" style={{ maxWidth: '440px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '14px' }}>Record Payout Settlement Receipt</h4>
            <form onSubmit={handleRecordPayoutSubmit}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>Select Finance Case (Outstanding)</label>
                <select
                  required
                  value={selectedCaseId}
                  onChange={e => {
                    setSelectedCaseId(e.target.value);
                    const selCase = cases.find(c => c.id.toString() === e.target.value);
                    if (selCase) setPayoutAmt(selCase.pending_payout.toString());
                  }}
                  style={{ padding: '8px', fontSize: '13px' }}
                >
                  <option value="">-- Choose active case --</option>
                  {cases.filter(c => c.pending_payout > 0).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.invoice_number} - {c.customer_name} ({c.finance_company}) [Pend: {fmtCurrency(c.pending_payout)}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>Received Amount (₹)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Enter received payout..."
                  value={payoutAmt}
                  onChange={e => setPayoutAmt(e.target.value)}
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>Date Received</label>
                <input
                  required
                  type="date"
                  value={payoutDate}
                  onChange={e => setPayoutDate(e.target.value)}
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>Reference / Txn ID (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. TXN-9021832049"
                  value={payoutRef}
                  onChange={e => setPayoutRef(e.target.value)}
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPayoutModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2, background: 'var(--brand)' }}>Record Payout Receipt ✓</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom Partner Modal */}
      {showAddPartnerModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddPartnerModal(false)}>
          <div className="modal" style={{ maxWidth: '380px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>Register Finance Partner Company</h4>
            <form onSubmit={handleAddPartnerSubmit}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>Finance Company Name</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. IDFC First Bank, Tata Capital..."
                  value={newPartnerName}
                  onChange={e => setNewPartnerName(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddPartnerModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2, background: 'var(--brand)' }}>Register Partner ✓</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
