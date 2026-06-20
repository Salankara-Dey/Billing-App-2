// AI OCR Parser Engine simulating local regex scanner or cloud AI layout parser

export interface OcrField<T = string | number> {
  value: T;
  confidence: number; // 0.0 to 1.0
}

export interface ExtractedInventoryItem {
  name: OcrField<string>;
  brand: OcrField<string>;
  model: OcrField<string>;
  quantity: OcrField<number>;
  purchasePrice: OcrField<number>;
  sellingPrice: OcrField<number>;
  hsnCode: OcrField<string>;
  gstPercentage: OcrField<number>;
  category: OcrField<string>;
}

export interface ExtractedInvoice {
  customerName: OcrField<string>;
  customerPhone: OcrField<string>;
  customerAddress: OcrField<string>;
  customerGstin: OcrField<string>;
  invoiceNumber: OcrField<string>;
  invoiceDate: OcrField<string>;
  items: Array<{
    name: OcrField<string>;
    quantity: OcrField<number>;
    price: OcrField<number>;
    gstPercentage: OcrField<number>;
    total: OcrField<number>;
  }>;
  totalAmount: OcrField<number>;
}

// Pre-seeded high fidelity mock inventory documents
export const MOCK_INVENTORY_DOCS = [
  {
    filename: "LG_TV_PriceList_Screenshot.png",
    text: `JIYA'S ARCADE - DISTRIBUTOR BATCH STOCK LIST
===========================================
Brand: LG | Category: Television | Source: Wholesaler
Items details:
1. LG UltraHD Smart TV 55" (Model: 55UQ8000) - HSN: 85287217 - GST: 18%
   Qty: 12 units | Purchase: ₹28,000 | Retail Sell: ₹34,500
2. LG Nanocell TV 65" (Model: 65NANO75) - HSN: 85287217 - GST: 18%
   Qty: 8 units | Purchase: ₹48,000 | Retail Sell: ₹57,999
3. LG Soundbar S40Q (Model: S40Q) - HSN: 85182200 - GST: 18%
   Qty: 20 units | Purchase: ₹8,500 | Retail Sell: ₹12,000`
  },
  {
    filename: "Scanned_Samsung_AC_Ledger.jpg",
    text: `JIYA'S ARCADE - SCANNED PHOTO OF INVENTORY LEDGER
================================================
Date: 2026-06-05 | Brand: Samsung
Category: Air Conditioner
------------------------------------------------
* Samsung 1.5 Ton WindFree (Model: AR18BY5AP) - HSN: 84151010 - GST: 28%
  Stock: 15 units | Cost Price: ₹32,000 | Market Price: ₹39,990
* Samsung Double Door AC (Model: AR24BY5AQ) - HSN: 84151010 - GST: 28%
  Stock: 6 units | Cost Price: ₹41,000 | Market Price: ₹49,990`
  },
  {
    filename: "Whirlpool_Fridges_PDF_Receipt.pdf",
    text: `JIYA'S ARCADE - LOCAL STORES PRODUCTS LIST
==========================================
Category: Refrigerator | Brand: Whirlpool
Whirlpool NeoFresh 265L (Model: NEO-265) | HSN: 84181000 | GST: 18%
Quantity: 10 Nos | Cost: ₹16,500 | M.R.P: ₹21,200
Whirlpool Protton 240L (Model: PRO-240) | HSN: 84181000 | GST: 18%
Quantity: 5 Nos | Cost: ₹21,000 | M.R.P: ₹26,500`
  },
  {
    filename: "Croma_Stock_Bulk_Update_Page1.png",
    text: `Bulk Update Items
=================
ITEM NAME* | CATEGORY | ITEM HSN | ITEM CODE
CROMA INV/AC 1.5T CRLA018IND283267 3S | Air Conditioner | 84151010 | 38642203548
CROMA INV/AC 1T CRLA012IND283266 3S | Air Conditioner | 84151010 | 38642490730
E Croma 40L PC AZE40 CRLC40LRCA175002 | Air Cooler | 84796000 | 38612284097
CROMA W/M Semi 7.5Kg CRAW2223 | Washing Machine | 84501200 | 38689467015
Croma T Shape Filterless Chimney 60 AG1111 | Chimney | 84146000 | 38626401258
Croma M/W Solo 20L CRM2025 | Microwave | 85165000 | 38629389555
CROMA M/W Conv 20L CRAMO193 Menu 200 | Microwave | 85165000 | 3861556581
Croma 15L Cyl Storage Geyser AV5111 | Geyser | 85161000 | 38621487095
Croma 25L StorageGeyser CRLH25LGYF254208 | Geyser | 85165000 | 38620593361
Croma Farrata Fan 135W CRSF135PFA303705 | Fan | 84145130 | 38616305665
E-Croma C/F AF2002 CRSFEB1CFB247702 B 1S | Fan | 84145120 | 38628776524
Croma MixerGrndr750WCRSK75WMGA183304 | Mixer Grinder | 85094010 | 38627134034
CROMA REF DC 206L 4S BB CRLR206DIE302702 | Refrigerator | 84182100 | 38620781231
Croma LED 109cm 43FGD024601 Google TV FHD | Television | 85287219 | 38697105233
Croma LED 140cm 55UGC24604 GTV UHD FF | Television | 85287219 | 38697078470
E-Croma LED 140cm 55UGC333801 GTV UHD | Television | 85287219 | 38618827948
CROMA REF INV 240L 3SMG CRLR240FID008951 | Refrigerator | 84182100 | 38678547889
CROMA REF INV 236L 2S CRLR236FIC276231 | Refrigerator | 84182100 | 38668035212
CROMA DC INVREF 251L 4S CRLR251DIE302704 | Refrigerator | 84182100 | 38673759204
CROMA REF DC 185L 2S RE CRLR185DCC008914 | Refrigerator | 84182100 | 38625561902
Croma 60W Laser CREA050DJA301502 PartySpk | Music System | 85182900 | 38653181779
Croma 120W Wired Sbar CREH120SBA260102 | Music System | 85182900 | 38694978934
Croma 500W PMPO Party Spk SP050BPE260101 | Music System | 85198940 | 38657152701`
  },
  {
    filename: "Croma_Stock_Bulk_Update_Page2.png",
    text: `Bulk Update Items
=================
ITEM NAME* | CATEGORY | ITEM HSN | ITEM CODE
Croma W/M Semi 7kg | Washing Machine | 84501200 | 38689467016
Croma 6 litre Air fryer | Air Fryer | 85166000 | 38655110192
Croma 5 litre instant Geyser | Geyser | 85162900 | 38621487096
Croma W/M 8kg FL | Washing Machine | 84501100 | 38689467017
Croma Dual Halogen Heater | Heater | 85162900 | 38621487097
Croma Mixer grinder750W4J | Mixer Grinder | 85094010 | 38627134035
Croma 3 litre instant geyser | Geyser | 85162900 | 38621487098
Croma ILED109cm43fdd024601 | Television | 85287220 | 3863061840
Realme Mobile | Mobile Phone | 85171300 | 38611228401
Croma LED 80cm 32HBD307601 HDR TV | Television | 85287219 | 38672839572
Croma QLED Pro 80cm CREL032HGC024605 | Television | 85287219 | 3866492083
Croma LED 80cm 32HCCO24601 Smart TV HD | Television | 85287219 | 38686177024
E-Croma LED 80cm 32HCC331801 Smart TV HD | Television | 85287219 | 38680430143
Realme C 71Sea blue 4/64 | Mobile Phone | 85171300 | 38611228402
Vivo Y31 5G Diamond green 6/128 | Mobile Phone | 85171300 | 38611228403
VivoY31 5GRose RED 4/128 | Mobile Phone | 85171300 | 38611228404
VIVO Y19S 5G Majestic green 4/64 | Mobile Phone | 85171300 | 38611228405
Croma LED 80cm 32HCC Smart TV | Television | 85287217 | 38672839573
Croma REF INV 240L 3S | Refrigerator | 84181000 | 38678547881
Croma REF DC 206L 4S | Refrigerator | 84181000 | 38678547882
Croma DC INV Ref 187 litre 5S | Refrigerator | 84181000 | 38678547883
Croma Celling fan AF2002 | Fan | 84145120 | 38616305666
Croma REF DC 45L 2S | Refrigerator | 84181000 | 38678547884
CromaW/MTL8kg TL | Washing Machine | 84501200 | 38689467018
Crom Built in Hob 3 burner | Hob | 73211190 | 38626401259
Croma M/W conv 20 litre | Microwave | 85165000 | 3861556582`
  }
];

// Pre-seeded high fidelity mock historical invoices
export const MOCK_INVOICE_DOCS = [
  {
    filename: "Invoice_Bajaj_Finance_Scan_09.png",
    text: `JIYA'S ARCADE - HISTORICAL RETAIL BILLING
==========================================
Invoice No: INV-OCR-7721
Date: 2026-06-05
Customer: Amit Banerjee
Phone: 9830219488
Address: 12 Santi Nagar main road, Siliguri
GSTIN: 19ABCDE1234F1Z0
Finance Partner: Bajaj Finance
Items listing:
- Sony Bravia Smart TV 32" | Qty: 1 | Price: ₹18,000 | GST: 18% | Total: ₹21,240
Down Payment: ₹3,240
EMI Amount: ₹1,500 / Month`
  },
  {
    filename: "Invoice_Cash_Receipt_489.pdf",
    text: `JIYA'S ARCADE - RETAIL TAX INVOICE
==================================
Invoice No: INV-OCR-3329
Date: 2026-06-05
Customer: Smita Paul
Phone: 9007421832
Address: Bidhan Road, Siliguri
GSTIN: N/A
Payment Method: Cash
Items details:
- Havells Pedestal Fan | Qty: 2 | Price: ₹2,800 | GST: 12% | Total: ₹6,272`
  }
];

// Local (offline) parser uses regex rules to scan text
export function processInventoryOcr(text: string, mode: 'local' | 'cloud' = 'local'): ExtractedInventoryItem[] {
  const items: ExtractedInventoryItem[] = [];

  // Parse Croma Bulk Update Items format
  if (text.includes("Bulk Update Items") || text.includes("CROMA") || text.includes("Croma") || text.includes("Realme") || text.includes("Vivo")) {
    const lines = text.split('\n');
    lines.forEach(line => {
      if (line.includes('|') && !line.includes('ITEM NAME*')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
          const name = parts[0];
          const category = parts[1] && parts[1] !== '--' ? parts[1] : 'General';
          const hsnCode = parts[2] && parts[2] !== '--' ? parts[2] : '85094010';
          const code = parts[3] && parts[3] !== '--' ? parts[3] : 'Generic';

          // Determine GST and price based on category or product name
          let gst = 18;
          let cost = 5000;
          let sell = 6500;
          let brand = 'Croma';
          let catResolved = category;

          if (name.toLowerCase().includes('realme')) brand = 'Realme';
          else if (name.toLowerCase().includes('vivo')) brand = 'Vivo';

          // Resolve category if -- or General
          if (catResolved === 'General' || catResolved === '--' || catResolved === '') {
            if (name.toLowerCase().includes('ac') || name.toLowerCase().includes('conditioner') || name.toLowerCase().includes('air conditioner')) catResolved = 'Air Conditioner';
            else if (name.toLowerCase().includes('ref') || name.toLowerCase().includes('fridge') || name.toLowerCase().includes('refrigerator')) catResolved = 'Refrigerator';
            else if (name.toLowerCase().includes('tv') || name.toLowerCase().includes('led') || name.toLowerCase().includes('qled')) catResolved = 'Television';
            else if (name.toLowerCase().includes('w/m') || name.toLowerCase().includes('washing')) catResolved = 'Washing Machine';
            else if (name.toLowerCase().includes('geyser')) catResolved = 'Geyser';
            else if (name.toLowerCase().includes('fan')) catResolved = 'Ceiling Fan';
            else if (name.toLowerCase().includes('cooler') || name.toLowerCase().includes('air cooler')) catResolved = 'Air Cooler';
            else if (name.toLowerCase().includes('microwave') || name.toLowerCase().includes('m/w') || name.toLowerCase().includes('solo') || name.toLowerCase().includes('conv')) catResolved = 'Microwave Oven';
            else if (name.toLowerCase().includes('mobile') || name.toLowerCase().includes('phone')) catResolved = 'Mobile Phone';
            else if (name.toLowerCase().includes('spk') || name.toLowerCase().includes('sbar')) catResolved = 'Speaker';
            else if (name.toLowerCase().includes('fryer')) catResolved = 'Kitchen Appliances';
          }

          if (catResolved === 'Air Conditioner') {
            gst = 28;
            cost = 28000;
            sell = 34500;
          } else if (catResolved === 'Refrigerator') {
            gst = 18;
            cost = 16500;
            sell = 21000;
          } else if (catResolved === 'Television') {
            gst = 18;
            cost = 18000;
            sell = 23000;
          } else if (catResolved === 'Air Cooler') {
            gst = 18;
            cost = 6500;
            sell = 8900;
          } else if (catResolved === 'Washing Machine') {
            gst = 18;
            cost = 11000;
            sell = 14500;
          } else if (catResolved === 'Geyser') {
            gst = 18;
            cost = 4500;
            sell = 6200;
          } else if (catResolved === 'Ceiling Fan' || catResolved === 'Fan') {
            gst = 18;
            cost = 1200;
            sell = 1800;
          } else if (catResolved === 'Microwave Oven' || catResolved === 'Microwave') {
            gst = 18;
            cost = 5500;
            sell = 7500;
          } else if (catResolved === 'Mobile Phone' || catResolved === 'Mobile') {
            gst = 18;
            cost = 12000;
            sell = 15000;
          } else if (catResolved === 'Speaker' || catResolved === 'Music System') {
            gst = 18;
            cost = 3500;
            sell = 5200;
          }

          items.push({
            name: { value: name, confidence: mode === 'cloud' ? 0.98 : 0.95 },
            brand: { value: brand, confidence: 0.99 },
            model: { value: code, confidence: 0.92 },
            quantity: { value: 10, confidence: 0.94 },
            purchasePrice: { value: cost, confidence: 0.90 },
            sellingPrice: { value: sell, confidence: 0.90 },
            hsnCode: { value: hsnCode, confidence: 0.88 },
            gstPercentage: { value: gst, confidence: 0.96 },
            category: { value: catResolved, confidence: 0.93 }
          });
        }
      }
    });
    if (items.length > 0) return items;
  }

  // Parse LG Template format
  const lgLines = text.match(/\d+\.\s+LG\s+[^\n]+/g);
  if (lgLines) {
    lgLines.forEach(line => {
      // e.g. LG UltraHD Smart TV 55" (Model: 55UQ8000) - HSN: 85287217 - GST: 18%
      const nameMatch = line.match(/\d+\.\s+(LG\s+[^Model]+)/);
      const modelMatch = line.match(/Model:\s*([^)]+)/);
      const hsnMatch = line.match(/HSN:\s*(\d+)/);
      const gstMatch = line.match(/GST:\s*(\d+)%/);

      // Search Qty / price line from subsequent text or parse line details
      // Qty: 12 units | Purchase: ₹28,000 | Retail Sell: ₹34,500
      const detailSegment = text.slice(text.indexOf(line));
      const qtyMatch = detailSegment.match(/Qty:\s*(\d+)/);
      const purchaseMatch = detailSegment.match(/Purchase:\s*₹?\s*([\d,]+)/);
      const sellMatch = detailSegment.match(/Retail\s*Sell:\s*₹?\s*([\d,]+)/);

      if (nameMatch) {
        items.push({
          name: { value: nameMatch[1].replace(/-$/, '').trim(), confidence: mode === 'cloud' ? 0.98 : 0.95 },
          brand: { value: 'LG', confidence: 0.99 },
          model: { value: modelMatch ? modelMatch[1].trim() : 'Generic', confidence: 0.92 },
          quantity: { value: qtyMatch ? parseInt(qtyMatch[1]) : 1, confidence: 0.94 },
          purchasePrice: { value: purchaseMatch ? parseInt(purchaseMatch[1].replace(/,/g, '')) : 0, confidence: 0.88 },
          sellingPrice: { value: sellMatch ? parseInt(sellMatch[1].replace(/,/g, '')) : 0, confidence: 0.88 },
          hsnCode: { value: hsnMatch ? hsnMatch[1] : '85287217', confidence: 0.76 }, // intentionally low for verification warning
          gstPercentage: { value: gstMatch ? parseInt(gstMatch[1]) : 18, confidence: 0.95 },
          category: { value: 'Television', confidence: 0.91 }
        });
      }
    });
    return items;
  }

  // Parse Samsung Template format
  const samLines = text.match(/\*\s+Samsung\s+[^\n]+/g);
  if (samLines) {
    samLines.forEach(line => {
      // e.g. * Samsung 1.5 Ton WindFree (Model: AR18BY5AP) - HSN: 84151010 - GST: 28%
      const nameMatch = line.match(/\*\s+(Samsung\s+[^Model]+)/);
      const modelMatch = line.match(/Model:\s*([^)]+)/);
      const hsnMatch = line.match(/HSN:\s*(\d+)/);
      const gstMatch = line.match(/GST:\s*(\d+)%/);

      const detailSegment = text.slice(text.indexOf(line));
      // Stock: 15 units | Cost Price: ₹32,000 | Market Price: ₹39,990
      const qtyMatch = detailSegment.match(/Stock:\s*(\d+)/);
      const purchaseMatch = detailSegment.match(/Cost\s*Price:\s*₹?\s*([\d,]+)/);
      const sellMatch = detailSegment.match(/Market\s*Price:\s*₹?\s*([\d,]+)/);

      if (nameMatch) {
        items.push({
          name: { value: nameMatch[1].replace(/-$/, '').trim(), confidence: mode === 'cloud' ? 0.99 : 0.96 },
          brand: { value: 'Samsung', confidence: 0.99 },
          model: { value: modelMatch ? modelMatch[1].trim() : 'Generic', confidence: 0.93 },
          quantity: { value: qtyMatch ? parseInt(qtyMatch[1]) : 1, confidence: 0.95 },
          purchasePrice: { value: purchaseMatch ? parseInt(purchaseMatch[1].replace(/,/g, '')) : 0, confidence: 0.90 },
          sellingPrice: { value: sellMatch ? parseInt(sellMatch[1].replace(/,/g, '')) : 0, confidence: 0.90 },
          hsnCode: { value: hsnMatch ? hsnMatch[1] : '84151010', confidence: 0.82 },
          gstPercentage: { value: gstMatch ? parseInt(gstMatch[1]) : 28, confidence: 0.97 },
          category: { value: 'Air Conditioner', confidence: 0.93 }
        });
      }
    });
    return items;
  }

  // Parse Whirlpool Template format
  const whirlpoolLines = text.match(/Whirlpool\s+NeoFresh[^\n]+|Whirlpool\s+Protton[^\n]+/gi);
  if (whirlpoolLines) {
    whirlpoolLines.forEach(line => {
      // Whirlpool NeoFresh 265L (Model: NEO-265) | HSN: 84181000 | GST: 18%
      const nameMatch = line.match(/(Whirlpool\s+[^|Model]+)/i);
      const modelMatch = line.match(/Model:\s*([^|)]+)/i);
      const hsnMatch = line.match(/HSN:\s*(\d+)/i);
      const gstMatch = line.match(/GST:\s*(\d+)%/i);

      const detailSegment = text.slice(text.indexOf(line));
      // Quantity: 10 Nos | Cost: ₹16,500 | M.R.P: ₹21,200
      const qtyMatch = detailSegment.match(/Quantity:\s*(\d+)/i);
      const purchaseMatch = detailSegment.match(/Cost:\s*₹?\s*([\d,]+)/i);
      const sellMatch = detailSegment.match(/M\.R\.P:\s*₹?\s*([\d,]+)/i);

      if (nameMatch) {
        items.push({
          name: { value: nameMatch[1].trim(), confidence: mode === 'cloud' ? 0.97 : 0.94 },
          brand: { value: 'Whirlpool', confidence: 0.99 },
          model: { value: modelMatch ? modelMatch[1].trim() : 'Generic', confidence: 0.90 },
          quantity: { value: qtyMatch ? parseInt(qtyMatch[1]) : 1, confidence: 0.94 },
          purchasePrice: { value: purchaseMatch ? parseInt(purchaseMatch[1].replace(/,/g, '')) : 0, confidence: 0.89 },
          sellingPrice: { value: sellMatch ? parseInt(sellMatch[1].replace(/,/g, '')) : 0, confidence: 0.89 },
          hsnCode: { value: hsnMatch ? hsnMatch[1] : '84181000', confidence: 0.69 }, // Low confidence trigger for testing
          gstPercentage: { value: gstMatch ? parseInt(gstMatch[1]) : 18, confidence: 0.96 },
          category: { value: 'Refrigerator', confidence: 0.92 }
        });
      }
    });
    return items;
  }

  // Generic/Custom Scanner fallback: parse lines split by comma or bar
  const lines = text.split('\n');
  lines.forEach(line => {
    if (line.includes(',') || line.includes('|')) {
      const parts = line.split(/[|]/).map(p => p.trim());
      if (parts.length >= 3) {
        items.push({
          name: { value: parts[0], confidence: 0.80 },
          brand: { value: parts[1] || 'Generic', confidence: 0.70 },
          model: { value: parts[2] || 'N/A', confidence: 0.70 },
          quantity: { value: parts[3] ? parseInt(parts[3]) || 1 : 1, confidence: 0.85 },
          purchasePrice: { value: parts[4] ? parseFloat(parts[4].replace(/[^\d.]/g, '')) || 0 : 0, confidence: 0.85 },
          sellingPrice: { value: parts[5] ? parseFloat(parts[5].replace(/[^\d.]/g, '')) || 0 : 0, confidence: 0.85 },
          hsnCode: { value: parts[6] || '85287217', confidence: 0.60 },
          gstPercentage: { value: parts[7] ? parseInt(parts[7].replace(/[^\d]/g, '')) || 18 : 18, confidence: 0.80 },
          category: { value: parts[8] || 'Electronics', confidence: 0.75 }
        });
      }
    }
  });

  return items;
}

export function processInvoiceOcr(text: string, mode: 'local' | 'cloud' = 'local'): ExtractedInvoice | null {
  const invMatch = text.match(/Invoice\s*No:\s*([A-Za-z0-9-]+)/i);
  const dateMatch = text.match(/Date:\s*([A-Za-z0-9-]+)/i);
  const custMatch = text.match(/Customer:\s*([^\r\n]+)/i);
  const phoneMatch = text.match(/Phone:\s*(\d{10})/i);
  const addrMatch = text.match(/Address:\s*([^\r\n]+)/i);
  const gstinMatch = text.match(/GSTIN:\s*([A-Za-z0-9]+)/i);

  if (!invMatch && !custMatch) return null;

  const itemDetails: any[] = [];
  // Parse item lines like: - Sony Bravia Smart TV 32" | Qty: 1 | Price: ₹18,000 | GST: 18% | Total: ₹21,240
  const lines = text.split('\n');
  lines.forEach(line => {
    if (line.trim().startsWith('-') && line.includes('Qty:')) {
      const name = line.substring(1, line.indexOf('|')).trim();
      const qtyMatch = line.match(/Qty:\s*(\d+)/i);
      const priceMatch = line.match(/Price:\s*₹?\s*([\d,]+)/i);
      const gstMatch = line.match(/GST:\s*(\d+)%/i);
      const totalMatch = line.match(/Total:\s*₹?\s*([\d,]+)/i);

      itemDetails.push({
        name: { value: name, confidence: mode === 'cloud' ? 0.98 : 0.95 },
        quantity: { value: qtyMatch ? parseInt(qtyMatch[1]) : 1, confidence: 0.96 },
        price: { value: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0, confidence: 0.92 },
        gstPercentage: { value: gstMatch ? parseInt(gstMatch[1]) : 18, confidence: 0.97 },
        total: { value: totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0, confidence: 0.92 }
      });
    }
  });

  const totalSum = itemDetails.reduce((s, i) => s + i.total.value, 0);

  return {
    customerName: { value: custMatch ? custMatch[1].trim() : 'Walk-in Customer', confidence: mode === 'cloud' ? 0.98 : 0.95 },
    customerPhone: { value: phoneMatch ? phoneMatch[1].trim() : '', confidence: mode === 'cloud' ? 0.97 : 0.90 },
    customerAddress: { value: addrMatch ? addrMatch[1].trim() : 'Siliguri', confidence: mode === 'cloud' ? 0.95 : 0.85 },
    customerGstin: { value: gstinMatch && gstinMatch[1].toLowerCase() !== 'n/a' ? gstinMatch[1].trim() : '', confidence: 0.80 },
    invoiceNumber: { value: invMatch ? invMatch[1].trim() : `INV-OCR-${Date.now().toString().slice(-4)}`, confidence: 0.99 },
    invoiceDate: { value: dateMatch ? dateMatch[1].trim() : new Date().toISOString().split('T')[0], confidence: 0.99 },
    items: itemDetails,
    totalAmount: { value: totalSum, confidence: 0.98 }
  };
}
