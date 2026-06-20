'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { dbQuery, dbRun } from '@/lib/api';
import { jsPDF } from 'jspdf';

interface Customer {
  id: number;
  name: string;
  mobile: string;
  address: string;
  gstin: string;
  outstanding_balance: number;
}

interface LedgerEntry {
  type: 'Invoice' | 'Payment';
  date: string;
  refNo: string;
  amount: number;
  paymentMode?: string;
  status?: string;
}

export default function LedgerView() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected customer history
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  // Record payment form state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_mode: 'Cash',
    reference: ''
  });

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    if (selectedCustomerId) {
      loadLedgerDetails(selectedCustomerId);
    } else {
      setInvoices([]);
      setPayments([]);
    }
  }, [selectedCustomerId]);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const res = await dbQuery('SELECT id, name, mobile, address, gstin, outstanding_balance FROM customers ORDER BY name ASC');
      setCustomers(res);
      if (res.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(res[0].id);
      }
    } catch (err) {
      console.error('Failed to load customers for ledger:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLedgerDetails = async (custId: number) => {
    try {
      const invs = await dbQuery('SELECT id, invoice_number, date, total, status, type FROM invoices WHERE customer_id = $1 ORDER BY date DESC, id DESC', [custId]);
      setInvoices(invs);

      const pmts = await dbQuery('SELECT id, amount, payment_date, payment_mode, reference FROM customer_payments WHERE customer_id = $1 ORDER BY payment_date DESC, id DESC', [custId]);
      setPayments(pmts);
    } catch (err) {
      console.error('Failed to load ledger details:', err);
    }
  };

  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const totalOutstandingAll = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.outstanding_balance || 0), 0);
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery) return customers;
    return customers.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.mobile?.includes(searchQuery)
    );
  }, [searchQuery, customers]);

  // Chronological running ledger entries
  const ledgerEntries = useMemo(() => {
    const entries: LedgerEntry[] = [];
    
    // Add Invoices
    invoices.forEach(inv => {
      entries.push({
        type: 'Invoice',
        date: inv.date,
        refNo: inv.invoice_number,
        amount: inv.total,
        status: inv.status
      });
    });

    // Add Payments
    payments.forEach(pmt => {
      entries.push({
        type: 'Payment',
        date: pmt.payment_date,
        refNo: `PMT-${String(pmt.id).padStart(4, '0')}`,
        amount: pmt.amount,
        paymentMode: pmt.payment_mode
      });
    });

    // Sort chronologically ascending to calculate running balance
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate running balance
    let currentBal = 0;
    return entries.map(entry => {
      if (entry.type === 'Invoice') {
        // If invoice is unpaid, it adds to customer's outstanding balance
        // Note: For running statement, we trace total sales debit vs payment credit
        currentBal += entry.amount;
      } else {
        currentBal -= entry.amount;
      }
      return {
        ...entry,
        runningBalance: currentBal
      };
    });
  }, [invoices, payments]);

  // Settle payments chronologically (FIFO)
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) return;
    const pmtAmt = parseFloat(paymentForm.amount);
    if (isNaN(pmtAmt) || pmtAmt <= 0) return alert('Payment amount must be greater than zero.');

    try {
      // 1. Save payment entry
      await dbRun(`
        INSERT INTO customer_payments (customer_id, amount, payment_date, payment_mode, reference)
        VALUES ($1, $2, $3, $4, $5)
      `, [selectedCustomerId, pmtAmt, paymentForm.payment_date, paymentForm.payment_mode, paymentForm.reference]);

      // 2. Adjust customer's outstanding balance
      await dbRun(`
        UPDATE customers 
        SET outstanding_balance = MAX(0, outstanding_balance - $1) 
        WHERE id = $2
      `, [pmtAmt, selectedCustomerId]);

      // 3. Settle unpaid invoices FIFO
      const unpaidInvs = await dbQuery(`
        SELECT id, total, invoice_number 
        FROM invoices 
        WHERE customer_id = $1 AND status = 'unpaid' 
        ORDER BY date ASC, id ASC
      `, [selectedCustomerId]);

      let remainingPayment = pmtAmt;
      const settledInvoices: string[] = [];

      for (const inv of unpaidInvs) {
        if (remainingPayment <= 0) break;
        
        // Since we can only mark paid or unpaid, if remaining payment covers the invoice, mark paid
        if (remainingPayment >= inv.total) {
          await dbRun("UPDATE invoices SET status = 'paid' WHERE id = $1", [inv.id]);
          remainingPayment -= inv.total;
          settledInvoices.push(inv.invoice_number);
        } else {
          // Partial payments aren't tracked at invoice level (schema has only paid/unpaid status).
          // We can optionally mark it as paid anyway if it's settled mostly, or skip.
          // To be safe, we only mark as paid if they fully settle.
          // Let's break here as we cannot mark partial.
          break;
        }
      }

      let msg = '✅ Payment logged successfully!';
      if (settledInvoices.length > 0) {
        msg += `\nSettled unpaid invoices: ${settledInvoices.join(', ')}`;
      }
      alert(msg);

      setShowPaymentModal(false);
      setPaymentForm({
        amount: '',
        payment_date: new Date().toISOString().split('T')[0],
        payment_mode: 'Cash',
        reference: ''
      });
      
      await loadCustomers();
      await loadLedgerDetails(selectedCustomerId);
    } catch (err: any) {
      alert(`Payment failed: ${err.message || err}`);
    }
  };

  // CSV Statement Export
  const handleExportCSV = () => {
    if (!selectedCustomer) return;
    let csvContent = `Customer Ledger Statement\n`;
    csvContent += `Customer Name,${selectedCustomer.name}\n`;
    csvContent += `Mobile,${selectedCustomer.mobile || '—'}\n`;
    csvContent += `GSTIN,${selectedCustomer.gstin || '—'}\n\n`;
    csvContent += `Date,Type,Reference No,Amount (INR),Payment Mode / Status,Running Balance (INR)\n`;

    ledgerEntries.forEach(entry => {
      const typeStr = entry.type;
      const modeOrStatus = entry.type === 'Invoice' ? entry.status : entry.paymentMode;
      csvContent += `${entry.date},${typeStr},${entry.refNo},${entry.amount.toFixed(2)},${modeOrStatus},${(entry as any).runningBalance.toFixed(2)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${selectedCustomer.name.replace(/\s+/g, '_')}_ledger.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // jsPDF Ledger Statement Export
  const handleExportPDF = () => {
    if (!selectedCustomer) return;
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    
    // Header Branding (Jiya's Arcade logo text)
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(249, 115, 22); // Orange brand color
    doc.text("JIYA'S ARCADE", 14, 15);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text("Siliguri, West Bengal, India | Phone: 9046726365", 14, 20);
    
    // Horizontal separator
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 23, pageW - 14, 23);

    // Document Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text("Customer Account Ledger Statement", 14, 32);

    // Customer details info card
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Customer Name: ${selectedCustomer.name}`, 14, 40);
    doc.text(`Phone/Mobile: ${selectedCustomer.mobile || '—'}`, 14, 45);
    doc.text(`GSTIN Reference: ${selectedCustomer.gstin || '—'}`, 14, 50);

    const outBal = selectedCustomer.outstanding_balance || 0;
    doc.setFont('helvetica', 'bold');
    doc.text(`Current Net Outstanding: Rs. ${outBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 120, 40);
    doc.setFont('helvetica', 'normal');
    doc.text(`Report Date: ${new Date().toLocaleDateString('en-IN')}`, 120, 45);

    // Table Column Headers
    let y = 60;
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, pageW - 28, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text("Date", 16, y + 5);
    doc.text("Entry Type", 40, y + 5);
    doc.text("Reference", 68, y + 5);
    doc.text("Amount (Dr/Cr)", 105, y + 5);
    doc.text("Mode / Status", 138, y + 5);
    doc.text("Balance (INR)", 172, y + 5);
    y += 7;

    // Table Rows
    doc.setFont('helvetica', 'normal');
    ledgerEntries.forEach((entry, idx) => {
      // Page break check
      if (y > 275) {
        doc.addPage();
        y = 15;
      }
      
      // Zebra striping
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y, pageW - 28, 6, 'F');
      }
      
      doc.text(entry.date, 16, y + 4.5);
      doc.text(entry.type, 40, y + 4.5);
      doc.text(entry.refNo, 68, y + 4.5);
      
      const amtText = `${entry.type === 'Invoice' ? 'Dr' : 'Cr'} Rs. ${entry.amount.toFixed(2)}`;
      doc.text(amtText, 105, y + 4.5);
      
      const details = entry.type === 'Invoice' ? (entry.status || '') : (entry.paymentMode || '');
      doc.text(details, 138, y + 4.5);
      
      const balVal = (entry as any).runningBalance;
      doc.text(`Rs. ${balVal.toFixed(2)}`, 172, y + 4.5);
      
      y += 6;
    });

    doc.save(`${selectedCustomer.name.replace(/\s+/g, '_')}_ledger.pdf`);
  };

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  };

  return (
    <div>
      <div className="section-header">
        <h3>Customer Outstanding Ledger</h3>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Side: Directory & Summary Card */}
        <div>
          {/* Metrics Card */}
          <div className="stat-card red" style={{ marginBottom: '20px' }}>
            <div className="label">Total Ledger Receivables</div>
            <div className="value">{fmtCurrency(totalOutstandingAll)}</div>
            <div className="sub">Sum of all outstanding bills</div>
          </div>

          {/* Customer Directory List */}
          <div className="card" style={{ padding: '20px 16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px' }}>Customer Directory</h4>
            <input 
              type="text" 
              placeholder="Search customers..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ marginBottom: '16px', padding: '8px 10px', fontSize: '13px' }}
            />

            {loading ? (
              <p style={{ textAlign: 'center', fontSize: '12px' }}>Loading directory...</p>
            ) : filteredCustomers.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--gray)', fontSize: '12px' }}>No matches found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
                {filteredCustomers.map(c => (
                  <div 
                    key={c.id} 
                    onClick={() => setSelectedCustomerId(c.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: selectedCustomerId === c.id ? 'var(--brand-light)' : 'transparent',
                      border: '1px solid',
                      borderColor: selectedCustomerId === c.id ? 'var(--brand)' : 'var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '13px', color: selectedCustomerId === c.id ? 'var(--brand-dark)' : 'var(--dark)' }}>{c.name}</strong>
                      <div style={{ fontSize: '10px', color: 'var(--gray)' }}>{c.mobile || 'no phone'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={`badge ${c.outstanding_balance > 0 ? 'badge-red' : 'badge-green'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                        {fmtCurrency(c.outstanding_balance || 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Detailed Chronological Running Ledger */}
        <div>
          {selectedCustomer ? (
            <div className="card" style={{ minHeight: '520px' }}>
              
              {/* Profile Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '20px' }}>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800 }}>{selectedCustomer.name}</h4>
                  <div style={{ fontSize: '12px', color: 'var(--gray)', marginTop: '4px' }}>
                    📞 {selectedCustomer.mobile || 'No contact phone'} | GSTIN: {selectedCustomer.gstin || 'Unregistered'}
                  </div>
                  {selectedCustomer.address && <div style={{ fontSize: '12px', color: 'var(--gray)', marginTop: '2px' }}>📍 {selectedCustomer.address}</div>}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-green btn-sm" onClick={() => setShowPaymentModal(true)}>
                    💵 Record Receipt
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>
                    📥 CSV
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}>
                    📄 PDF Report
                  </button>
                </div>
              </div>

              {/* Outstanding balance widget */}
              <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', padding: '12px 18px', flex: 1 }}>
                  <div style={{ fontSize: '11px', color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase' }}>Net Outstanding balance</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--red)', marginTop: '4px' }}>{fmtCurrency(selectedCustomer.outstanding_balance)}</div>
                </div>
                <div style={{ background: 'var(--brand-light)', border: '1px solid #ffedd5', borderRadius: '8px', padding: '12px 18px', flex: 1 }}>
                  <div style={{ fontSize: '11px', color: 'var(--brand-dark)', fontWeight: 700, textTransform: 'uppercase' }}>Pending Invoice Count</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--brand-dark)', marginTop: '4px' }}>
                    {invoices.filter(i => i.status === 'unpaid').length} unpaid bills
                  </div>
                </div>
              </div>

              {/*Chronological Ledger Table */}
              <h5 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px' }}>Running Statement of Account</h5>
              {ledgerEntries.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--gray)', padding: '32px 0' }}>No invoice or payment history found for this account.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Transaction Type</th>
                        <th>Reference#</th>
                        <th>Debit (Charge)</th>
                        <th>Credit (Payment)</th>
                        <th>Mode / Status</th>
                        <th style={{ textAlign: 'right' }}>Running Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.map((entry, idx) => (
                        <tr key={idx}>
                          <td>{entry.date}</td>
                          <td>
                            <strong style={{ color: entry.type === 'Invoice' ? 'var(--dark)' : 'var(--green)' }}>
                              {entry.type === 'Invoice' ? '📈 Sales Invoice' : '📥 Payment Received'}
                            </strong>
                          </td>
                          <td><code>{entry.refNo}</code></td>
                          <td style={{ color: 'var(--dark)' }}>
                            {entry.type === 'Invoice' ? fmtCurrency(entry.amount) : '—'}
                          </td>
                          <td style={{ color: 'var(--green)', fontWeight: 600 }}>
                            {entry.type === 'Payment' ? fmtCurrency(entry.amount) : '—'}
                          </td>
                          <td>
                            {entry.type === 'Invoice' ? (
                              <span className={`badge ${entry.status === 'paid' ? 'badge-green' : 'badge-red'}`} style={{ padding: '2px 6px', fontSize: '10px' }}>
                                {entry.status}
                              </span>
                            ) : (
                              <span style={{ fontSize: '12px', fontWeight: 600 }}>{entry.paymentMode}</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {fmtCurrency((entry as any).runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          ) : (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '520px', color: 'var(--gray)' }}>
              Select a customer from the directory to inspect their chronological outstanding ledger statement.
            </div>
          )}
        </div>

      </div>

      {/* Record Payment Modal */}
      {showPaymentModal && selectedCustomer && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '460px' }}>
            <h3 className="modal-title">Record Payment Receipt</h3>
            <form onSubmit={handleRecordPayment}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                
                <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '6px', fontSize: '13px' }}>
                  Customer Account: <strong>{selectedCustomer.name}</strong><br/>
                  Total Due: <strong style={{ color: 'var(--red)' }}>{fmtCurrency(selectedCustomer.outstanding_balance)}</strong>
                </div>

                <div className="form-group">
                  <label>Payment Amount Received (₹) *</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    placeholder="Enter amount..."
                    value={paymentForm.amount}
                    onChange={e => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Receipt Date</label>
                  <input 
                    type="date" 
                    required 
                    value={paymentForm.payment_date}
                    onChange={e => setPaymentForm(prev => ({ ...prev, payment_date: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Payment Mode</label>
                  <select 
                    value={paymentForm.payment_mode}
                    onChange={e => setPaymentForm(prev => ({ ...prev, payment_mode: e.target.value }))}
                  >
                    <option>Cash</option>
                    <option>UPI</option>
                    <option>Bank Transfer</option>
                    <option>Card</option>
                    <option>Cheque</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Reference / Transaction ID (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. UPI Txn No, Cheque No"
                    value={paymentForm.reference}
                    onChange={e => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))}
                  />
                </div>

              </div>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn btn-primary">Save Receipt & Settle Bills</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
