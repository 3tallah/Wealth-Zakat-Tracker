import { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";

const INITIAL_EXCHANGE = {
  EGP: 1,
  USD: 47.9,
  AED: 13,
  SAR: 12.75,
  EUR: 52,
  GBP: 60,
  KWD: 155,
  QAR: 13,
  JOD: 67,
};

const FX_CODES = ["USD", "AED", "SAR", "EUR", "GBP", "KWD", "QAR", "JOD"];

const TEXT = {
  ar: {
    title: "حساب الثروة والزكاة",
    tabs: {
      about: "عن الزكاة",
      dashboard: "لوحة القيادة",
      assets: "الأصول",
      zakat: "الزكاة",
      history: "السجل التاريخي",
    },
    exchangeNow: "أسعار الصرف الحالية (مقابل الجنيه المصري)",
    fetchRates: "تحديث تلقائي من API",
    fetching: "جاري التحديث...",
    rateStatusDefault: "لم يتم التحديث بعد — الأسعار الافتراضية قيد الاستخدام",
    rateUpdated: "✅ تم تحديث الأسعار:",
    rateFailed: "⚠️ تعذّر جلب الأسعار — يتم استخدام القيم الحالية",
    exportExcel: "تصدير تقرير Excel",
    exportPdf: "تصدير تقرير PDF",
    exportDone: "تم تصدير التقرير بنجاح",
    exportPdfDone: "تم تصدير ملف PDF بنجاح",
  },
  en: {
    title: "Wealth & Zakat Tracker",
    tabs: {
      dashboard: "Dashboard",
      assets: "Assets",
      about: "About Zakah",
      zakat: "Zakat",
      history: "History",
    },
    exchangeNow: "Current exchange rates (to EGP)",
    fetchRates: "Refresh from API",
    fetching: "Fetching...",
    rateStatusDefault: "Not updated yet — using default rates",
    rateUpdated: "✅ Rates updated:",
    rateFailed: "⚠️ Could not fetch rates — using current values",
    exportExcel: "Export Excel report",
    exportPdf: "Export PDF report",
    exportDone: "Report exported successfully",
    exportPdfDone: "PDF exported successfully",
  },
};

const INITIAL_ASSETS_2026 = [];

const INITIAL_DEBTS = [];

const CATEGORY_COLORS = {
  "نقد وسيولة": "#4ECDC4",
  "معادن ثمينة": "#FFD93D",
  "استثمارات": "#6BCB77",
  "صناديق واستثمارات": "#6BCB77",
  "مصالح تجارية": "#FF6B6B",
  "عقارات": "#A78BFA",
};

const CATEGORY_LABELS = {
  "نقد وسيولة": { ar: "نقد وسيولة", en: "Cash & Liquidity" },
  "معادن ثمينة": { ar: "ذهب", en: "Gold" },
  "استثمارات": { ar: "استثمارات", en: "Investments" },
  "صناديق واستثمارات": { ar: "صناديق الاستثمار طويل الأجل", en: "Investment Funds" },
  "مصالح تجارية": { ar: "مصالح تجارية", en: "Business Interests" },
  "عقارات": { ar: "عقارات", en: "Real Estate" },
};

const SESSION_STORAGE_KEY = "zakat-tracker:session:v1";
const CONTRIBUTION_URL = "https://github.com/3tallah/Wealth-Zakat-Tracker.git";
const ISSUES_URL = "https://github.com/3tallah/Wealth-Zakat-Tracker/issues";

const RADIAN = Math.PI / 180;

const renderPieLabel = ({ cx, cy, midAngle, outerRadius, percent }) => {
  if (percent < 0.09) return null;
  const radius = outerRadius + 18;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#F0F6FC" stroke="#0D1117" strokeWidth={2} paintOrder="stroke" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={13} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const renderPieLabelLine = ({ points, percent }) => {
  if (percent < 0.09 || !points || points.length < 2) return null;
  const [start, end] = points;
  return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#C9D1D9" strokeWidth={1} />;
};

export default function App() {
  const [lang, setLang] = useState("ar");
  const [assets, setAssets] = useState(INITIAL_ASSETS_2026);
  const [debts, setDebts] = useState(INITIAL_DEBTS);
  const [exchange, setExchange] = useState(INITIAL_EXCHANGE);
  const [yearlySnapshots, setYearlySnapshots] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [editingAsset, setEditingAsset] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [year, setYear] = useState(2026);
  const [rateStatus, setRateStatus] = useState(TEXT.ar.rateStatusDefault);
  const [ratesLastUpdated, setRatesLastUpdated] = useState(null);
  const [isFetchingRates, setIsFetchingRates] = useState(false);
  const [goldPrice24k, setGoldPrice24k] = useState(0);
  const [goldLastUpdated, setGoldLastUpdated] = useState(null);
  const [goldStatus, setGoldStatus] = useState("idle");
  const [isFetchingGold, setIsFetchingGold] = useState(false);
  const [appNotice, setAppNotice] = useState("");
  const [newDebtAmount, setNewDebtAmount] = useState("");

  const t = TEXT[lang];
  const isRtl = lang === "ar";
  const tr = (ar, en) => (lang === "ar" ? ar : en);
  const fmt = (n) => new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 0 }).format(n);
  const parseLocalizedNumber = (raw) => {
    if (raw === null || raw === undefined) return NaN;
    const normalized = String(raw)
      .trim()
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/٫/g, ".")
      .replace(/[٬,\s]/g, "");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : NaN;
  };
  const fmtK = (n) => {
    if (n >= 1e6) {
      return lang === "ar" ? `${(n / 1e6).toFixed(2)}م` : `${(n / 1e6).toFixed(2)}M`;
    }
    if (n >= 1e3) {
      return lang === "ar" ? `${(n / 1e3).toFixed(0)}ك` : `${(n / 1e3).toFixed(0)}K`;
    }
    return n.toFixed(0);
  };
  const getCategoryLabel = (category) => CATEGORY_LABELS[category]?.[lang] || category;
  const getAssetName = (asset) => (lang === "ar" ? asset.name : (asset.nameEn || asset.name));
  const getAssetDescription = (asset) => {
    if (lang === "ar") return asset.description;
    return asset.descriptionEn || asset.description;
  };
  const getAssetNotes = (asset) => {
    if (lang === "ar") return asset.notes;
    return asset.notesEn || asset.notes;
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
  }, [lang, isRtl]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed?.assets)) setAssets(parsed.assets);
      if (Array.isArray(parsed?.debts)) setDebts(parsed.debts.map((d) => Number(d)).filter((d) => Number.isFinite(d)));
      if (Array.isArray(parsed?.yearlySnapshots)) setYearlySnapshots(parsed.yearlySnapshots);

      if (Number.isFinite(Number(parsed?.year))) setYear(Number(parsed.year));

      if (parsed?.exchange && typeof parsed.exchange === "object") {
        const next = { ...INITIAL_EXCHANGE };
        Object.keys(next).forEach((code) => {
          const value = Number(parsed.exchange?.[code]);
          if (Number.isFinite(value) && value > 0) next[code] = value;
        });
        setExchange(next);
      }

      if (typeof parsed?.ratesLastUpdated === "string") setRatesLastUpdated(parsed.ratesLastUpdated);

      const savedGold = Number(parsed?.goldPrice24k);
      if (Number.isFinite(savedGold) && savedGold > 0) setGoldPrice24k(savedGold);
      if (typeof parsed?.goldLastUpdated === "string") setGoldLastUpdated(parsed.goldLastUpdated);
    } catch {
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          assets,
          debts,
          exchange,
          yearlySnapshots,
          year,
          ratesLastUpdated,
          goldPrice24k,
          goldLastUpdated,
        })
      );
    } catch {
    }
  }, [assets, debts, exchange, yearlySnapshots, year, ratesLastUpdated, goldPrice24k, goldLastUpdated]);

  useEffect(() => {
    setRateStatus(ratesLastUpdated ? `${t.rateUpdated} ${ratesLastUpdated}` : t.rateStatusDefault);
  }, [lang, ratesLastUpdated, t.rateStatusDefault, t.rateUpdated]);

  useEffect(() => {
    if (!appNotice) return;
    const timeoutId = setTimeout(() => setAppNotice(""), 2600);
    return () => clearTimeout(timeoutId);
  }, [appNotice]);

  const saveExchangeSettings = () => {
    setAppNotice(tr("تم حفظ أسعار الصرف في هذه الجلسة", "Exchange rates saved for this session"));
  };

  const saveGoldPrice = () => {
    const value = Number(goldPrice24k);
    if (!Number.isFinite(value) || value <= 0) return;
    const stamp = new Date().toLocaleString();
    setGoldLastUpdated(stamp);
    setGoldStatus("saved");
  };

  const fetchGoldPrice = useCallback(async () => {
    setIsFetchingGold(true);
    try {
      const res = await fetch("https://api.gold-api.com/price/XAU");
      const data = await res.json();

      const usdPerOunce = Number(data?.price || data?.price_usd || data?.xau || 0);
      let nextPrice = 0;

      if (Number.isFinite(usdPerOunce) && usdPerOunce > 0) {
        const usdPerGram = usdPerOunce / 31.1034768;
        const egpPerUsd = Number(exchange.USD || INITIAL_EXCHANGE.USD);
        nextPrice = usdPerGram * egpPerUsd;
      }

      if (!(Number.isFinite(nextPrice) && nextPrice > 0)) {
        throw new Error("Gold API parse failed");
      }

      const rounded = Number(nextPrice.toFixed(2));
      const stamp = new Date().toLocaleString();
      setGoldPrice24k(rounded);
      setGoldLastUpdated(stamp);
      setGoldStatus("ok");
    } catch {
      setGoldStatus("fail");
    } finally {
      setIsFetchingGold(false);
    }
  }, [exchange.USD]);

  const fetchRates = async () => {
    setIsFetchingRates(true);
    try {
      const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      const data = await res.json();
      const rates = data?.rates;
      if (!rates?.EGP) throw new Error("No EGP rate");

      const egpPerUsd = Number(rates.EGP);
      const next = { ...exchange, EGP: 1, USD: egpPerUsd };
      FX_CODES.filter((code) => code !== "USD").forEach((code) => {
        if (rates[code]) next[code] = egpPerUsd / Number(rates[code]);
      });

      const stamp = new Date().toLocaleString();
      setExchange(next);
      setRatesLastUpdated(stamp);
      setRateStatus(`${t.rateUpdated} ${stamp}`);
    } catch {
      setRateStatus(t.rateFailed);
    } finally {
      setIsFetchingRates(false);
    }
  };

  useEffect(() => {
    fetchRates();
  }, []);

  useEffect(() => {
    fetchGoldPrice();
    const intervalId = setInterval(fetchGoldPrice, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchGoldPrice]);

  const toEGP = (val, curr) => {
    if (curr === "EGP") return val;
    const rate = exchange[curr];
    if (Number.isFinite(rate) && rate > 0) return val * rate;
    return val;
  };

  const computed = useMemo(() => {
    const assetsWithEGP = assets.map((a) => ({
      ...a,
      valueEGP: toEGP(a.value, a.currency),
      zakatableValueEGP: a.zakatable ? toEGP(a.value, a.currency) * (a.zakatBasis || 1) : 0,
      zakatDueEGP: a.zakatable ? toEGP(a.value, a.currency) * (a.zakatBasis || 1) * 0.025 : 0,
    }));

    const totalAssets = assetsWithEGP.reduce((s, a) => s + a.valueEGP, 0);
    const totalDebts = debts.reduce((s, d) => s + (d || 0), 0);
    const totalLiabilities = totalDebts;
    const netWorth = totalAssets - totalLiabilities;
    const totalZakatable = assetsWithEGP.reduce((s, a) => s + a.zakatableValueEGP, 0);
    const netZakatableAfterDebts = Math.max(totalZakatable - totalDebts, 0);
    const totalZakat = netZakatableAfterDebts * 0.025;

    const byCategory = {};
    assetsWithEGP.forEach((a) => {
      byCategory[a.category] = (byCategory[a.category] || 0) + a.valueEGP;
    });
    const pieData = Object.entries(byCategory).map(([k, v]) => ({ name: k, value: Math.round(v) }));

    const totalCash = byCategory["نقد وسيولة"] || 0;
    const totalGold = byCategory["معادن ثمينة"] || 0;
    const totalInvestments = (byCategory["استثمارات"] || 0) + (byCategory["صناديق واستثمارات"] || 0) + (byCategory["مصالح تجارية"] || 0);
    const totalRealEstate = byCategory["عقارات"] || 0;

    return { assetsWithEGP, totalCash, totalGold, totalInvestments, totalRealEstate, totalAssets, totalDebts, totalLiabilities, netWorth, totalZakatable, netZakatableAfterDebts, totalZakat, pieData };
  }, [assets, debts, exchange]);

  const saveSnapshot = () => {
    const snap = { year, totalAssets: computed.totalAssets, totalLiabilities: computed.totalLiabilities, netWorth: computed.netWorth, totalZakat: computed.totalZakat };
    setYearlySnapshots((prev) => {
      const idx = prev.findIndex((s) => s.year === year);
      if (idx >= 0) { const n = [...prev]; n[idx] = snap; return n; }
      return [...prev, snap].sort((a, b) => a.year - b.year);
    });
    setYear((y) => y + 1);
  };

  const snapData = useMemo(() => {
    const base = { year: 2026, totalAssets: computed.totalAssets, netWorth: computed.netWorth, totalZakat: computed.totalZakat };
    return [base, ...yearlySnapshots.filter((s) => s.year !== 2026)];
  }, [yearlySnapshots, computed]);

  const exportToExcel = () => {
    const now = new Date();
    const wb = XLSX.utils.book_new();

    const summary = [
      ["تقرير الثروة والزكاة", "Wealth & Zakat Report"],
      ["Generated", now.toLocaleString()],
      ["Rates Last Updated", ratesLastUpdated || "N/A"],
      [],
      ["Total Assets (EGP)", Math.round(computed.totalAssets)],
      ["Total Liabilities (EGP)", Math.round(computed.totalLiabilities)],
      ["Net Worth (EGP)", Math.round(computed.netWorth)],
      ["Zakatable Base (EGP)", Math.round(computed.netZakatableAfterDebts)],
      ["Zakat Due (EGP)", Math.round(computed.totalZakat)],
    ];

    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary["!cols"] = [{ wch: 32 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    const detailsHeader = [["#", "Name", "Name EN", "Category", "Currency", "Original Value", "Value EGP", "Zakatable", "Zakat Base %", "Zakat Due EGP"]];
    const detailsRows = computed.assetsWithEGP.map((a, i) => [
      i + 1,
      a.name,
      a.nameEn || "",
      a.category,
      a.currency,
      a.value,
      Math.round(a.valueEGP),
      a.zakatable ? "Yes" : "No",
      Math.round((a.zakatBasis || 1) * 100),
      Math.round(a.zakatDueEGP),
    ]);

    const wsDetails = XLSX.utils.aoa_to_sheet([...detailsHeader, ...detailsRows]);
    wsDetails["!cols"] = [{ wch: 5 }, { wch: 28 }, { wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsDetails, "Assets");

    const ratesHeader = [["Currency", "to EGP", "Last Updated"]];
    const ratesRows = Object.keys(exchange).map((code) => [code, exchange[code], ratesLastUpdated || "N/A"]);
    const wsRates = XLSX.utils.aoa_to_sheet([...ratesHeader, ...ratesRows]);
    wsRates["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, wsRates, "Rates");

    XLSX.writeFile(wb, `wealth-zakat-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.xlsx`);
    setAppNotice(t.exportDone);
  };

  const exportToPdf = () => {
    const now = new Date();
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 36;
    const toPdfSafeText = (text, fallback) => {
      const value = String(text || "").trim();
      if (!value) return fallback;
      return /[^\x00-\x7F]/.test(value) ? fallback : value;
    };

    doc.setFillColor(22, 27, 34);
    doc.rect(0, 0, pageWidth, 90, "F");
    doc.setTextColor(255, 217, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Wealth & Zakat Report", marginX, 40);
    doc.setTextColor(210, 217, 200);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${now.toLocaleString()}`, marginX, 58);
    doc.text(`Rates Updated: ${ratesLastUpdated || "N/A"}`, marginX, 72);

    autoTable(doc, {
      startY: 108,
      head: [["Summary", "Value (EGP)"]],
      body: [
        ["Total Assets", Math.round(computed.totalAssets).toLocaleString()],
        ["Total Liabilities", Math.round(computed.totalLiabilities).toLocaleString()],
        ["Net Worth", Math.round(computed.netWorth).toLocaleString()],
        ["Zakatable Base", Math.round(computed.netZakatableAfterDebts).toLocaleString()],
        ["Zakat Due (2.5%)", Math.round(computed.totalZakat).toLocaleString()],
      ],
      headStyles: { fillColor: [200, 168, 75], textColor: [13, 17, 23] },
      styles: { fontSize: 10, cellPadding: 6 },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      theme: "striped",
      margin: { left: marginX, right: marginX },
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [["#", "Asset", "Category", "Currency", "Original", "Value EGP", "Zakat Due EGP"]],
      body: computed.assetsWithEGP.map((asset, index) => [
        index + 1,
        toPdfSafeText(asset.nameEn || asset.name, `Asset ${index + 1}`),
        toPdfSafeText(CATEGORY_LABELS[asset.category]?.en || asset.category, "Category"),
        asset.currency,
        Math.round(asset.value).toLocaleString(),
        Math.round(asset.valueEGP).toLocaleString(),
        Math.round(asset.zakatDueEGP).toLocaleString(),
      ]),
      headStyles: { fillColor: [78, 205, 196], textColor: [13, 17, 23] },
      styles: { fontSize: 9, cellPadding: 5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      theme: "grid",
      margin: { left: marginX, right: marginX },
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [["Currency", "Rate to EGP"]],
      body: Object.keys(exchange).map((code) => [code, Number(exchange[code]).toFixed(4)]),
      headStyles: { fillColor: [107, 203, 119], textColor: [13, 17, 23] },
      styles: { fontSize: 9, cellPadding: 5 },
      theme: "striped",
      margin: { left: marginX, right: marginX },
    });

    doc.save(`wealth-zakat-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.pdf`);
    setAppNotice(t.exportPdfDone);
  };

  const addDebt = () => {
    const value = parseLocalizedNumber(newDebtAmount);
    if (!Number.isFinite(value) || value <= 0) return;
    setDebts((prev) => [...prev, value]);
    setNewDebtAmount("");
  };

  const TABS = [
    { id: "about", label: t.tabs.about },
    { id: "dashboard", label: t.tabs.dashboard },
    { id: "assets", label: t.tabs.assets },
    { id: "zakat", label: t.tabs.zakat },
    { id: "history", label: t.tabs.history },
  ];

  const aboutSection = (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 24, color: "#E6EDF3", marginBottom: 4 }}>{tr("عن الزكاة وفوائدها", "About Zakah and Its Benefits")}</div>
              <div style={{ color: "#8B949E", fontSize: 14 }}>{tr("ركن الإسلام الثالث وتطهير للنفس والمال", "The third pillar of Islam and purification of soul and wealth")}</div>
            </div>
            <div style={{ borderRight: isRtl ? "3px solid #4ECDC4" : "none", borderLeft: isRtl ? "none" : "3px solid #4ECDC4", paddingRight: isRtl ? 12 : 0, paddingLeft: isRtl ? 0 : 12 }}>
              <div style={{ fontWeight: 800, color: "#4ECDC4", marginBottom: 6 }}>{tr("لماذا نخرج الزكاة؟", "Why do we pay Zakah?")}</div>
              <div style={{ fontSize: 13, color: "#C9D1D9", marginBottom: 8 }}>{tr("فريضة مالية .. وعبادة قلبية", "A financial duty and a spiritual devotion")}</div>
              <p style={{ lineHeight: 1.8, color: "#D2D9C8", fontSize: 14 }}>
                {tr("الزكاة هي الركن الثالث من أركان الإسلام، وهي ليست مجرد ضريبة تؤخذ من الأغنياء، بل هي وسيلة لتطهير النفس من الشح والبخل، وتنمية المال بالبركة.", "Zakah is the third pillar of Islam. It is not merely a tax on wealth, but a way to purify the heart from greed and increase wealth through blessing.")}
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {[tr("سد حاجات الفقراء والمساكين", "Covering the needs of the poor and needy"), tr("نشر المحبة والتكافل في المجتمع", "Spreading compassion and solidarity in society"), tr("تحصين المال من الآفات", "Protecting wealth from harm")].map((benefit) => (
                <div key={benefit} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(78,205,196,0.08)", border: "1px solid rgba(78,205,196,0.25)", borderRadius: 10, padding: "10px 12px", color: "#C9D1D9", fontSize: 13 }}>
                  <span style={{ color: "#4ECDC4" }}>✓</span>
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="stat-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#FFD93D" }}>{tr("شروط وجوب الزكاة", "Conditions for Zakah Obligation")}</div>
            <div style={{ display: "grid", gap: 10 }}>
              {[tr("الإسلام والحرية", "Islam and freedom"), tr("بلوغ النصاب (ما يعادل 85 جرام ذهب عيار 24)", "Reaching nisab (equivalent to 85g of 24K gold)"), tr("مرور حول كامل (سنة هجرية) على امتلاك المال", "Completion of one lunar year over the wealth"), tr("الملك التام للمال والخلو من الديون", "Full ownership of wealth and freedom from due debts")].map((item) => (
                <div key={item} style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#E6EDF3", fontSize: 13 }}>
                  <span style={{ color: "#FFD93D", marginTop: 2 }}>•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignSelf: isRtl ? "stretch" : "flex-start" }}>
              <button className="btn btn-gold" onClick={() => setActiveTab("assets")}>
                {tr("ابدأ بإضافة الأصول", "Add assets")}
              </button>
              <button className="btn btn-ghost" onClick={() => setActiveTab("zakat")}>
                {tr("انتقل لحساب زكاتك", "Calculate Zakah")}
              </button>
              <button className="btn btn-ghost" onClick={() => setActiveTab("dashboard")}>
                {tr("انتقل إلى لوحة القيادة", "Go to Dashboard")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 14 }}>{tr("لمن تخرج الزكاة؟", "Who can receive Zakah?")}</div>
        <div className="grid4">
          {[
            { ar: "الفقراء والمساكين", en: "Poor and Needy" },
            { ar: "الغارمين", en: "Debtors" },
            { ar: "العاملين عليها", en: "Administrators of Zakah" },
            { ar: "ابن السبيل", en: "Wayfarers" },
          ].map((recipient) => (
            <div key={recipient.ar} className="stat-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>🤲</div>
              <div style={{ fontWeight: 700, color: "#C9D1D9", fontSize: 13 }}>{lang === "ar" ? recipient.ar : recipient.en}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const footerSection = (
    <footer className="card" style={{ background: "linear-gradient(180deg, #0d2b22 0%, #123429 100%)", borderColor: "#2A4F41", overflow: "hidden" }}>
      <div className="grid3" style={{ gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#E6EDF3" }}>{tr("زكاة أونلاين", "Zakah Online")}</div>
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(200,168,75,0.3)", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 20, color: "#FFD93D", marginBottom: 6 }}>{'"مَا نَقَصَتْ صَدَقَةٌ مِنْ مَالٍ"'}</div>
            <div style={{ color: "#8B949E", fontSize: 12 }}>{tr("حديث شريف", "Prophetic Hadith")}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 800, color: "#E6EDF3" }}>{tr("تبرع الآن", "Donate Now")}</div>
          {[
            { ar: "بنك الشفاء المصري", en: "Egyptian Cure Bank", url: "https://www.egyptiancurebank.com/ar/donate-now" },
            { ar: "جمعية الأورمان", en: "Orman Association", url: "https://www.dar-alorman.com/donate" },
            { ar: "مؤسسة مجدي يعقوب", en: "Magdi Yacoub Foundation", url: "https://myf-egypt.org/ar/donation/" },
          ].map((link) => (
            <a key={link.ar} href={link.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "#C9D1D9", border: "1px solid rgba(200,168,75,0.25)", borderRadius: 10, padding: "10px 12px", background: "rgba(255,255,255,0.02)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{lang === "ar" ? link.ar : link.en}</span>
              <span style={{ color: "#FFD93D" }}>↗</span>
            </a>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 800, color: "#E6EDF3" }}>{tr("روابط مفيدة", "Useful Links")}</div>
          {[
            { ar: "عداد التسبيح الإلكتروني", en: "Digital Tasbeeh Counter", url: "https://do-calculate.com/calculator/ar/tally-counter/" },
            { ar: "مواقيت الصلاة", en: "Prayer Times", url: "https://timesprayer.com/prayer-times-in-cairo.html" },
          ].map((link) => (
            <a key={link.ar} href={link.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "#C9D1D9", fontSize: 13 }}>
              • {lang === "ar" ? link.ar : link.en}
            </a>
          ))}

          <a
            href={ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none", color: "#C9D1D9", border: "1px solid rgba(200,168,75,0.25)", borderRadius: 10, padding: "10px 12px", background: "rgba(255,255,255,0.02)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 700 }}
          >
            <span>{tr("شاركنا ملاحظاتك أو افتح Issue على GitHub", "Share feedback or open an issue on GitHub")}</span>
            <span style={{ color: "#FFD93D" }}>↗</span>
          </a>

          <div style={{ marginTop: 6, border: "1px solid rgba(200,168,75,0.25)", borderRadius: 12, padding: 12, background: "rgba(0,0,0,0.18)" }}>
            <div style={{ color: "#C9D1D9", fontSize: 12, lineHeight: 1.7, marginBottom: 8 }}>
              {tr("هذه الحاسبة وسيلة مساعدة للتقدير، يرجى دائماً مراجعة دار الإفتاء في الحالات المعقدة لضمان صحة الفريضة.", "This calculator is an estimation aid. Please consult Dar Al-Ifta in complex cases to ensure correct obligation.")}
            </div>
            <a href="https://dar-alifta.org/ar/fatwa/details/18349" target="_blank" rel="noopener noreferrer" style={{ color: "#FFD93D", fontSize: 13, fontWeight: 700 }}>
              {tr("تفاصيل النصاب الشرعي بموقع دار الإفتاء", "Nisab details on Dar Al-Ifta website")}
            </a>
          </div>

          <div style={{ marginTop: 4, color: "#8B949E", fontSize: 12, lineHeight: 1.7 }}>
            <span style={{ color: "#4ECDC4", fontWeight: 700 }}>{tr("تحديث أسعار الذهب", "Gold Price Updates")}: </span>
            {tr("نراقب أسعار الذهب اليوم لحظة بلحظة لتحديد النصاب الشرعي بدقة، لتسهيل عملية حساب الزكاة للمسلمين في جميع أنحاء العالم.", "We monitor today’s gold prices closely to determine nisab accurately and make Zakah calculation easier for Muslims worldwide.")}
          </div>
        </div>
      </div>
    </footer>
  );

  return (
    <div style={{ background: "#1a4a3a", minHeight: "100vh", color: "#E6EDF3", fontFamily: "'Almarai', 'Cairo', sans-serif", direction: isRtl ? "rtl" : "ltr", position: "relative", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&family=Cairo:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .app-bg::before { content: ''; position: fixed; inset: 0; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23c8a84b' stroke-width='0.4' opacity='0.18'%3E%3Cpolygon points='60,10 110,35 110,85 60,110 10,85 10,35'/%3E%3Cpolygon points='60,25 95,42 95,78 60,95 25,78 25,42'/%3E%3Cline x1='60' y1='10' x2='60' y2='25'/%3E%3Cline x1='110' y1='35' x2='95' y2='42'/%3E%3Cline x1='110' y1='85' x2='95' y2='78'/%3E%3Cline x1='60' y1='110' x2='60' y2='95'/%3E%3Cline x1='10' y1='85' x2='25' y2='78'/%3E%3Cline x1='10' y1='35' x2='25' y2='42'/%3E%3C/g%3E%3C/svg%3E"); background-size: 120px 120px; pointer-events: none; z-index: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #16372d; } ::-webkit-scrollbar-thumb { background: #c8a84b; border-radius: 3px; }
        input, select, textarea { background: #161B22; border: 1px solid #30363D; color: #E6EDF3; padding: 8px 12px; border-radius: 8px; font-family: inherit; font-size: 14px; width: 100%; outline: none; transition: border 0.2s; }
        input:focus, select:focus { border-color: #FFD93D; }
        .btn { padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 600; transition: all 0.2s; }
        .btn-gold { background: linear-gradient(135deg, #FFD93D, #FFC200); color: #0D1117; }
        .btn-gold:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(255,217,61,0.4); }
        .btn-ghost { background: transparent; border: 1px solid #C8A84B55; color: #D7C07A; }
        .btn-ghost:hover { border-color: #FFD93D; color: #FFD93D; }
        .btn-danger { background: rgba(248,81,73,0.15); border: 1px solid rgba(248,81,73,0.4); color: #F85149; }
        .btn-danger:hover { background: rgba(248,81,73,0.25); }
        .card { background: #161B22; border: 1px solid #21262D; border-radius: 16px; padding: 24px; position: relative; z-index: 2; }
        .stat-card { background: linear-gradient(135deg, #161B22 0%, #1C2128 100%); border: 1px solid #21262D; border-radius: 16px; padding: 20px 24px; position: relative; overflow: hidden; }
        .tag { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .tag-yes { background: rgba(107,203,119,0.15); color: #6BCB77; border: 1px solid rgba(107,203,119,0.3); }
        .tag-no { background: rgba(139,148,158,0.1); color: #8B949E; border: 1px solid #30363D; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal { background: #161B22; border: 1px solid #30363D; border-radius: 20px; padding: 30px; width: 100%; max-width: 540px; max-height: 90vh; overflow-y: auto; }
        .tab { padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 500; transition: all 0.2s; }
        .tab-active { background: rgba(255,217,61,0.15); color: #FFD93D; border: 1px solid rgba(255,217,61,0.3); }
        .tab-inactive { background: transparent; color: #d2d9c8; border: 1px solid transparent; }
        .tab-inactive:hover { color: #E6EDF3; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #0D1117; padding: 12px 16px; text-align: ${isRtl ? "right" : "left"}; font-size: 12px; color: #C9D1D9; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #21262D; }
        td { padding: 14px 16px; border-bottom: 1px solid #1C2128; font-size: 14px; vertical-align: middle; }
        tr:hover td { background: rgba(255,217,61,0.03); }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .exchange-items { display: flex; gap: 12px; flex-wrap: nowrap; align-items: center; flex: 1 1 auto; min-width: 0; overflow-x: auto; padding-bottom: 4px; }
        .exchange-item { display: flex; align-items: center; gap: 12px; white-space: nowrap; flex: 0 0 auto; }
        @media (max-width: 768px) { .grid4, .grid3 { grid-template-columns: 1fr 1fr; } .grid2 { grid-template-columns: 1fr; } }
        @media (max-width: 480px) { .grid4, .grid3, .grid2 { grid-template-columns: 1fr; } }
        .glow-gold { box-shadow: 0 0 20px rgba(255,217,61,0.15); }
        .section-title { font-size: 13px; font-weight: 800; color: #C9D1D9; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
        .lang-toggle { display: flex; border-radius: 999px; overflow: hidden; border: 1px solid rgba(200,168,75,0.4); background: rgba(0,0,0,0.35); backdrop-filter: blur(10px); flex-shrink: 0; }
        .lang-btn { border: none; background: transparent; color: rgba(200,168,75,0.7); font-size: 12px; font-weight: 700; padding: 8px 14px; cursor: pointer; }
        .lang-btn.active { background: #c8a84b; color: #0d2b22; }
        .github-badge { display: inline-flex; align-items: center; gap: 6px; color: #E6EDF3; text-decoration: none; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-weight: 700; background: rgba(0,0,0,0.2); }
        .github-badge:hover { border-color: rgba(255,217,61,0.6); color: #FFD93D; }
      `}</style>

      <div className="app-bg" />

      {appNotice && (
        <div style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 120, background: "#0f2f25", color: "#E6EDF3", border: "1px solid #4ECDC4", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, boxShadow: "0 8px 20px rgba(0,0,0,0.35)" }}>
          ✅ {appNotice}
        </div>
      )}

      <div style={{ background: "linear-gradient(180deg, #0d2b22 0%, #16382d 100%)", borderBottom: "1px solid #37564a", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, background: "#3f3f12", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>💰</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#E6EDF3" }}>{t.title}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {[
            { id: "about", label: t.tabs.about },
            { id: "dashboard", label: t.tabs.dashboard },
            { id: "assets", label: t.tabs.assets },
            { id: "zakat", label: t.tabs.zakat },
            { id: "history", label: t.tabs.history },
          ].map((tab) => (
            <button key={tab.id} className={`tab ${activeTab === tab.id ? "tab-active" : "tab-inactive"}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
          ))}
          <a href={CONTRIBUTION_URL} target="_blank" rel="noopener noreferrer" className="github-badge" title={tr("ساهم في تطوير هذا المشروع", "Contribute to this project")}> 
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.247a10 10 0 0 0-3.162 19.487c.5.088.687-.212.687-.475c0-.237-.012-1.025-.012-1.862c-2.513.462-3.163-.613-3.363-1.175a3.64 3.64 0 0 0-1.025-1.413c-.35-.187-.85-.65-.013-.662a2 2 0 0 1 1.538 1.025a2.137 2.137 0 0 0 2.912.825a2.1 2.1 0 0 1 .638-1.338c-2.225-.25-4.55-1.112-4.55-4.937a3.9 3.9 0 0 1 1.025-2.688a3.6 3.6 0 0 1 .1-2.65s.837-.262 2.75 1.025a9.43 9.43 0 0 1 5 0c1.912-1.3 2.75-1.025 2.75-1.025a3.6 3.6 0 0 1 .1 2.65a3.87 3.87 0 0 1 1.025 2.688c0 3.837-2.338 4.687-4.562 4.937a2.37 2.37 0 0 1 .674 1.85c0 1.338-.012 2.413-.012 2.75c0 .263.187.575.687.475A10.005 10.005 0 0 0 12 2.247"></path>
            </svg>
            <span>{tr("ساهم في المشروع", "Contribute")}</span>
          </a>
          <div className="lang-toggle">
            <button className={`lang-btn ${lang === "ar" ? "active" : ""}`} onClick={() => setLang("ar")}>AR</button>
            <button className={`lang-btn ${lang === "en" ? "active" : ""}`} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
      </div>

      <div style={{ padding: "32px", maxWidth: 1400, margin: "0 auto", position: "relative", zIndex: 2 }}>
        {activeTab === "about" && aboutSection}
        {activeTab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: 13, color: "#d2d9c8", fontWeight: 700 }}>{t.exchangeNow}</div>
              <div className="exchange-items">
                {FX_CODES.map((code) => (
                  <div key={code} className="exchange-item">
                    <span style={{ color: "#8B949E", fontSize: 13 }}>1 {code} =</span>
                    <input
                      type="number"
                      step="0.01"
                      value={Number(exchange[code] || 0).toFixed(2)}
                      onChange={(e) => setExchange((x) => ({ ...x, [code]: Number(e.target.value) }))}
                      style={{
                        width: `${Math.max(String(Number(exchange[code] || 0).toFixed(2)).length + 1, 6)}ch`,
                        minWidth: "10ch",
                        padding: "6px 8px",
                        fontSize: 13,
                        textAlign: "center",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn btn-ghost" onClick={saveExchangeSettings}>{tr("حفظ الأسعار", "Save Rates")}</button>
                <button className="btn btn-gold" onClick={fetchRates} disabled={isFetchingRates}>{isFetchingRates ? t.fetching : t.fetchRates}</button>
              </div>
              <div style={{ fontSize: 12, color: "#8B949E", width: "100%" }}>{rateStatus}</div>
              <div style={{ width: "100%", height: 1, background: "#2A3138", margin: "4px 0" }} />
              <div style={{ fontSize: 13, color: "#d2d9c8", fontWeight: 700 }}>{tr("سعر جرام الذهب 24 (API + تعديل يدوي)", "24K Gold Gram Price (API + Manual Edit)")}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="number"
                  step="0.01"
                  value={goldPrice24k || ""}
                  onChange={(e) => setGoldPrice24k(Number(e.target.value))}
                  placeholder={tr("أدخل سعر الجرام", "Enter gram price")}
                  style={{ width: 220 }}
                />
                <button className="btn btn-ghost" onClick={saveGoldPrice}>{tr("حفظ السعر", "Save Price")}</button>
                <button className="btn btn-gold" onClick={fetchGoldPrice} disabled={isFetchingGold}>{isFetchingGold ? tr("جاري الجلب...", "Fetching...") : tr("تحديث من Gold API", "Fetch from Gold API")}</button>
              </div>
              <div style={{ fontSize: 12, color: "#8B949E", width: "100%" }}>
                {goldStatus === "ok" && `${tr("✅ تم تحديث سعر الذهب:", "✅ Gold price updated:")} ${goldLastUpdated || ""}`}
                {goldStatus === "saved" && `${tr("💾 تم حفظ السعر يدويًا:", "💾 Price saved manually:")} ${goldLastUpdated || ""}`}
                {goldStatus === "fail" && tr("⚠️ تعذّر جلب السعر من API — يمكنك التعديل والحفظ يدويًا", "⚠️ Could not fetch from API — you can edit and save manually")}
                {goldStatus === "idle" && tr("يمكنك تحديث السعر من API أو تعديله يدويًا وحفظه", "You can fetch from API or edit manually and save")}
              </div>
            </div>

            <div className="grid4">
              {[{ label: tr("إجمالي الأصول", "Total Assets"), value: computed.totalAssets, color: "#4ECDC4", icon: "📊" }, { label: tr("إجمالي الالتزامات", "Total Liabilities"), value: computed.totalLiabilities, color: "#F85149", icon: "📉" }, { label: tr("صافي الثروة", "Net Worth"), value: computed.netWorth, color: "#6BCB77", icon: "💰" }, { label: tr("الزكاة المستحقة", "Zakat Due"), value: computed.totalZakat, color: "#FFD93D", icon: "☾" }].map((c) => (
                <div key={c.label} className="stat-card glow-gold">
                  <div style={{ position: "absolute", top: 0, right: 0, width: 3, height: "100%", background: c.color, borderRadius: "0 16px 16px 0" }} />
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{c.icon}</div>
                  <div style={{ fontSize: 13, color: "#8B949E", marginBottom: 6 }}>{c.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: c.color }}>{fmt(c.value)}</div>
                  <div style={{ fontSize: 12, color: "#8B949E", marginTop: 4 }}>{tr("جنيه مصري", "EGP")}</div>
                </div>
              ))}
            </div>

            <div className="grid3">
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "20px 24px 0", fontWeight: 700, fontSize: 16 }}>{tr("ملخص الثروة", "Wealth Summary")}</div>
                <table style={{ marginTop: 12 }}>
                  <thead>
                    <tr><th>{tr("البند", "Item")}</th><th>{tr("القيمة بالجنيه", "Value (EGP)")}</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>{tr("إجمالي النقد", "Total Cash")}</td><td style={{ color: "#4ECDC4", fontWeight: 700 }}>{fmt(Math.round(computed.totalCash))}</td></tr>
                    <tr><td>{tr("إجمالي الذهب", "Total Gold")}</td><td style={{ color: "#FFD93D", fontWeight: 700 }}>{fmt(Math.round(computed.totalGold))}</td></tr>
                    <tr><td>{tr("إجمالي الاستثمارات", "Total Investments")}</td><td style={{ color: "#6BCB77", fontWeight: 700 }}>{fmt(Math.round(computed.totalInvestments))}</td></tr>
                    <tr><td>{tr("إجمالي العقارات", "Total Real Estate")}</td><td style={{ color: "#A78BFA", fontWeight: 700 }}>{fmt(Math.round(computed.totalRealEstate))}</td></tr>
                    <tr><td style={{ fontWeight: 900 }}>{tr("إجمالي الأصول", "Total Assets")}</td><td style={{ color: "#4ECDC4", fontWeight: 900 }}>{fmt(Math.round(computed.totalAssets))}</td></tr>
                    <tr><td style={{ fontWeight: 900 }}>{tr("إجمالي الالتزامات", "Total Liabilities")}</td><td style={{ color: "#F85149", fontWeight: 900 }}>{fmt(Math.round(computed.totalLiabilities))}</td></tr>
                    <tr style={{ borderTop: "2px solid #30363D" }}><td style={{ fontWeight: 900, color: "#E6EDF3" }}>{tr("صافي الثروة", "Net Worth")}</td><td style={{ color: "#6BCB77", fontWeight: 900 }}>{fmt(Math.round(computed.netWorth))}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="card">
                <div className="section-title">{tr("توزيع الأصول حسب الفئة", "Asset Allocation by Category")}</div>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={computed.pieData} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value" labelLine={renderPieLabelLine} label={renderPieLabel}>
                      {computed.pieData.map((entry, i) => <Cell key={i} fill={CATEGORY_COLORS[entry.name] || "#8B949E"} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [fmt(v) + " EGP", tr("القيمة", "Value")]} labelFormatter={(name) => getCategoryLabel(name)} contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 10, color: "#F0F6FC", fontFamily: "Almarai", fontSize: 13, fontWeight: 700 }} labelStyle={{ color: "#F0F6FC", fontWeight: 700 }} itemStyle={{ color: "#F0F6FC", fontWeight: 700 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                  {computed.pieData.map((d) => (
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#C9D1D9", fontWeight: 600 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: CATEGORY_COLORS[d.name] || "#8B949E" }} />
                      {getCategoryLabel(d.name)}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="section-title">{tr("الأصول مقابل الالتزامات وصافي الثروة", "Assets vs Liabilities vs Net Worth")}</div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={[{ name: "2026", assets: Math.round(computed.totalAssets), liabilities: Math.round(computed.totalLiabilities), netWorth: Math.round(computed.netWorth) }]} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262D" />
                    <XAxis dataKey="name" tick={{ fill: "#C9D1D9", fontSize: 12, fontWeight: 600 }} axisLine={{ stroke: "#30363D" }} tickLine={false} />
                    <YAxis tick={{ fill: "#C9D1D9", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                    <Tooltip formatter={(v, n) => [fmt(v) + " EGP", n === "assets" ? tr("الأصول", "Assets") : n === "liabilities" ? tr("الالتزامات", "Liabilities") : tr("صافي الثروة", "Net Worth")]} contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 10, color: "#F0F6FC", fontFamily: "Almarai", fontSize: 13, fontWeight: 700 }} labelStyle={{ color: "#F0F6FC", fontWeight: 700 }} itemStyle={{ color: "#F0F6FC", fontWeight: 700 }} />
                    <Bar dataKey="assets" fill="#4ECDC4" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="liabilities" fill="#F85149" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="netWorth" fill="#6BCB77" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#E6EDF3" }}>{tr("حفظ لقطة سنوية", "Save Yearly Snapshot")}</div>
                <div style={{ fontSize: 13, color: "#8B949E", marginTop: 4 }}>{tr(`احفظ القيم الحالية كبيانات أساسية لعام ${year} لتتبع النمو عبر السنوات`, `Save current values as a baseline for ${year} to track growth over years`)}</div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} style={{ width: 100 }} />
                <button className="btn btn-gold" onClick={saveSnapshot}>💾 {tr(`حفظ ${year}`, `Save ${year}`)}</button>
              </div>
            </div>

            <div className="card">
              <div className="section-title">{tr("الديون", "Debts")}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={newDebtAmount}
                  onChange={(e) => setNewDebtAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addDebt();
                  }}
                  placeholder={tr("أدخل قيمة الدين", "Enter debt amount")}
                  style={{ width: 220 }}
                />
                <button className="btn btn-gold" onClick={addDebt}>{tr("+ إضافة دين", "+ Add Debt")}</button>
              </div>
              <div className="grid2" style={{ alignItems: "start" }}>
                <div>
                  <table>
                    <thead>
                      <tr><th>{tr("البند", "Item")}</th><th>{tr("القيمة (ج.م)", "Value (EGP)")}</th><th>{tr("إجراءات", "Actions")}</th></tr>
                    </thead>
                    <tbody>
                      {debts.length === 0 && (
                        <tr>
                          <td colSpan={3} style={{ color: "#8B949E", textAlign: "center" }}>{tr("لا توجد ديون مضافة", "No debts added")}</td>
                        </tr>
                      )}
                      {debts.map((d, idx) => (
                        <tr key={idx}>
                          <td>{tr("دين", "Debt")} {idx + 1}</td>
                          <td style={{ color: "#F85149", fontWeight: 700 }}>{fmt(Math.round(d))}</td>
                          <td>
                            <button className="btn btn-danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setDebts((prev) => prev.filter((_, i) => i !== idx))}>
                              {tr("حذف", "Delete")}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {debts.length > 0 && (
                        <tr style={{ borderTop: "2px solid #30363D" }}>
                          <td style={{ fontWeight: 900, color: "#E6EDF3" }}>{tr("إجمالي الديون", "Total Debts")}</td>
                          <td style={{ fontWeight: 900, color: "#F85149" }}>{fmt(Math.round(computed.totalDebts))}</td>
                          <td style={{ color: "#8B949E" }}>—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "#8B949E", marginBottom: 8 }}>{tr("الديون المدخلة", "Entered Debts")}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "#F85149" }}>{fmt(Math.round(computed.totalDebts))}</div>
                  <div style={{ fontSize: 12, color: "#8B949E", marginTop: 10, marginBottom: 8 }}>{tr("إجمالي الالتزامات", "Total Liabilities")}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: "#E6EDF3" }}>{fmt(Math.round(computed.totalLiabilities))}</div>
                  <div style={{ position: "absolute", top: 0, right: 0, width: 3, height: "100%", background: "#F85149", borderRadius: "0 16px 16px 0" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "assets" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontWeight: 900, fontSize: 22 }}>{tr("سجل الأصول", "Assets Register")}</h2>
              <button className="btn btn-gold" onClick={() => setShowAddForm(true)}>{tr("+ إضافة أصل", "+ Add Asset")}</button>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>{tr("الأصل", "Asset")}</th><th>{tr("الفئة", "Category")}</th><th>{tr("القيمة الأصلية", "Original Value")}</th><th>{tr("القيمة (ج.م)", "Value (EGP)")}</th><th>{tr("تدفق نقدي", "Cash Flow")}</th><th>{tr("زكاة", "Zakat")}</th><th>{tr("ملاحظات", "Notes")}</th><th>{tr("إجراءات", "Actions")}</th></tr></thead>
                  <tbody>
                    {computed.assetsWithEGP.map((a) => (
                      <tr key={a.id}>
                        <td><div style={{ fontWeight: 600, color: "#E6EDF3" }}>{getAssetName(a)}</div><div style={{ fontSize: 12, color: "#8B949E" }}>{getAssetDescription(a)}</div></td>
                        <td><span style={{ padding: "3px 10px", borderRadius: 20, background: CATEGORY_COLORS[a.category] + "22", color: CATEGORY_COLORS[a.category] || "#8B949E", fontSize: 12, fontWeight: 600 }}>{getCategoryLabel(a.category)}</span></td>
                        <td style={{ fontFamily: "monospace", fontSize: 13 }}>{fmt(a.value)} {a.currency}</td>
                        <td style={{ color: "#4ECDC4", fontWeight: 700 }}>{fmt(Math.round(a.valueEGP))}</td>
                        <td><span className={`tag ${a.cashFlow ? "tag-yes" : "tag-no"}`}>{a.cashFlow ? tr("نعم", "Yes") : tr("لا", "No")}</span></td>
                        <td><span className={`tag ${a.zakatable ? "tag-yes" : "tag-no"}`}>{a.zakatable ? tr("خاضع", "Eligible") : tr("غير خاضع", "Not Eligible")}</span></td>
                        <td style={{ fontSize: 12, color: "#8B949E", maxWidth: 160 }}>{getAssetNotes(a)}</td>
                        <td><div style={{ display: "flex", gap: 6 }}><button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setEditingAsset(a)}>{tr("تعديل", "Edit")}</button><button className="btn btn-danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setAssets((prev) => prev.filter((x) => x.id !== a.id))}>{tr("حذف", "Delete")}</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "zakat" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <h2 style={{ fontWeight: 900, fontSize: 22 }}>{tr("حاسبة الزكاة", "Zakat Calculator")}</h2>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-gold" onClick={exportToExcel}>📊 {t.exportExcel}</button>
              <button className="btn btn-ghost" onClick={exportToPdf}>🧾 {t.exportPdf}</button>
            </div>
            <div className="grid3">
              {[{ label: tr("إجمالي وعاء الزكاة (قبل الديون)", "Total Zakat Base (Before Debts)"), value: computed.totalZakatable, color: "#FFD93D" }, { label: tr("صافي وعاء الزكاة (بعد الديون)", "Net Zakat Base (After Debts)"), value: computed.netZakatableAfterDebts, color: "#6BCB77" }, { label: tr("الزكاة المستحقة (2.5%)", "Zakat Due (2.5%)"), value: computed.totalZakat, color: "#C8A84B" }].map((c) => (
                <div key={c.label} className="stat-card">
                  <div style={{ fontSize: 12, color: "#8B949E", marginBottom: 8 }}>{c.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: c.color }}>{fmt(Math.round(c.value))}</div>
                  <div style={{ fontSize: 12, color: "#8B949E" }}>{tr("جنيه مصري", "EGP")}</div>
                  <div style={{ position: "absolute", top: 0, right: 0, width: 3, height: "100%", background: c.color, borderRadius: "0 16px 16px 0" }} />
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "20px 24px 0", fontWeight: 700, fontSize: 16 }}>{tr("تفاصيل الزكاة حسب الأصل", "Zakat Details by Asset")}</div>
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>{tr("الأصل", "Asset")}</th><th>{tr("الفئة", "Category")}</th><th>{tr("القيمة (ج.م)", "Value (EGP)")}</th><th>{tr("نسبة الوعاء", "Zakat Basis %")}</th><th>{tr("وعاء الزكاة (ج.م)", "Zakat Base (EGP)")}</th><th>{tr("الزكاة (ج.م)", "Zakat (EGP)")}</th></tr>
                </thead>
                <tbody>
                  {computed.assetsWithEGP.filter((a) => a.zakatable).map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{getAssetName(a)}</td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 20, background: CATEGORY_COLORS[a.category] + "22", color: CATEGORY_COLORS[a.category] || "#8B949E", fontSize: 12 }}>{getCategoryLabel(a.category)}</span></td>
                      <td style={{ color: "#4ECDC4" }}>{fmt(Math.round(a.valueEGP))}</td>
                      <td style={{ color: "#FFD93D" }}>{((a.zakatBasis || 1) * 100).toFixed(0)}%</td>
                      <td>{fmt(Math.round(a.zakatableValueEGP))}</td>
                      <td style={{ color: "#F85149", fontWeight: 700 }}>{fmt(Math.round(a.zakatDueEGP))}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid #30363D" }}><td colSpan={4} style={{ fontWeight: 900, color: "#E6EDF3" }}>{tr("إجمالي وعاء الزكاة (قبل الديون)", "Total Zakat Base (Before Debts)")}</td><td style={{ fontWeight: 900, color: "#FFD93D" }}>{fmt(Math.round(computed.totalZakatable))}</td><td style={{ color: "#8B949E" }}>—</td></tr>
                  <tr><td colSpan={4} style={{ fontWeight: 900, color: "#E6EDF3" }}>{tr("خصم الديون", "Debts Deduction")}</td><td style={{ fontWeight: 900, color: "#F85149" }}>- {fmt(Math.round(computed.totalDebts))}</td><td style={{ color: "#8B949E" }}>—</td></tr>
                  <tr><td colSpan={4} style={{ fontWeight: 900, color: "#E6EDF3" }}>{tr("صافي وعاء الزكاة (بعد الديون)", "Net Zakat Base (After Debts)")}</td><td style={{ fontWeight: 900, color: "#6BCB77" }}>{fmt(Math.round(computed.netZakatableAfterDebts))}</td><td style={{ fontWeight: 900, color: "#F85149" }}>{fmt(Math.round(computed.totalZakat))}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <h2 style={{ fontWeight: 900, fontSize: 22 }}>{tr("السجل التاريخي السنوي", "Yearly History")}</h2>
            {snapData.length < 2 && (
              <div className="card" style={{ textAlign: "center", padding: 40, color: "#8B949E" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
                <div>{tr("احفظ لقطات سنوية من لوحة القيادة لبدء تتبع النمو عبر السنوات", "Save yearly snapshots from dashboard to start tracking growth")}</div>
              </div>
            )}
            {snapData.length >= 1 && (
              <div className="card">
                <div className="section-title">{tr("تطور صافي الثروة والزكاة", "Net Worth and Zakat Trend")}</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={snapData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262D" />
                    <XAxis dataKey="year" tick={{ fill: "#8B949E", fontSize: 12 }} axisLine={{ stroke: "#30363D" }} tickLine={false} />
                    <YAxis tick={{ fill: "#8B949E", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                    <Tooltip formatter={(v, n) => [fmt(v) + " EGP", n === "netWorth" ? tr("صافي الثروة", "Net Worth") : n === "totalAssets" ? tr("الأصول", "Assets") : tr("الزكاة", "Zakat")]} contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 10, fontFamily: "Almarai" }} />
                    <Legend formatter={(v) => v === "netWorth" ? tr("صافي الثروة", "Net Worth") : v === "totalAssets" ? tr("الأصول", "Assets") : tr("الزكاة", "Zakat")} />
                    <Line type="monotone" dataKey="netWorth" stroke="#6BCB77" strokeWidth={2.5} dot={{ fill: "#6BCB77", r: 5 }} />
                    <Line type="monotone" dataKey="totalAssets" stroke="#4ECDC4" strokeWidth={2} dot={{ fill: "#4ECDC4", r: 4 }} />
                    <Line type="monotone" dataKey="totalZakat" stroke="#FFD93D" strokeWidth={2} dot={{ fill: "#FFD93D", r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {snapData.length >= 1 && (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table>
                  <thead><tr><th>{tr("السنة", "Year")}</th><th>{tr("إجمالي الأصول", "Total Assets")}</th><th>{tr("الالتزامات", "Liabilities")}</th><th>{tr("صافي الثروة", "Net Worth")}</th><th>{tr("الزكاة", "Zakat")}</th></tr></thead>
                  <tbody>
                    {snapData.map((s) => (
                      <tr key={s.year}>
                        <td style={{ fontWeight: 700, color: "#FFD93D" }}>{s.year}</td>
                        <td style={{ color: "#4ECDC4" }}>{fmt(Math.round(s.totalAssets))}</td>
                        <td style={{ color: "#F85149" }}>{fmt(Math.round(s.totalLiabilities || 0))}</td>
                        <td style={{ color: "#6BCB77", fontWeight: 700 }}>{fmt(Math.round(s.netWorth))}</td>
                        <td style={{ color: "#FFD93D" }}>{fmt(Math.round(s.totalZakat))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          {footerSection}
        </div>
      </div>

      {editingAsset && (
        <div className="modal-overlay" onClick={() => setEditingAsset(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 20 }}>{tr("تعديل", "Edit")}: {getAssetName(editingAsset)}</div>
            <AssetForm lang={lang} asset={editingAsset} goldPrice24k={goldPrice24k} onSave={(updated) => { setAssets((prev) => prev.map((a) => a.id === updated.id ? updated : a)); setEditingAsset(null); }} onCancel={() => setEditingAsset(null)} />
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 20 }}>{tr("إضافة أصل جديد", "Add New Asset")}</div>
            <AssetForm lang={lang} asset={{ id: Date.now(), name: "", nameEn: "", category: "نقد وسيولة", description: "", value: 0, currency: "EGP", cashFlow: false, zakatable: true, notes: "", zakatBasis: 1 }} goldPrice24k={goldPrice24k} isNew onSave={(a) => { setAssets((prev) => [...prev, a]); setShowAddForm(false); }} onCancel={() => setShowAddForm(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function AssetForm({ lang, asset, goldPrice24k, isNew, onSave, onCancel }) {
  const [form, setForm] = useState({ ...asset });
  const tr = (ar, en) => (lang === "ar" ? ar : en);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const CATS = ["نقد وسيولة", "معادن ثمينة", "استثمارات", "صناديق واستثمارات", "عقارات"];
  const isGoldCategory = form.category === "معادن ثمينة";
  const isFundsCategory = form.category === "صناديق واستثمارات";
  const toPositiveNumber = (value) => {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : 0;
  };
  const goldWeight18 = toPositiveNumber(form.goldWeight18);
  const goldWeight21 = toPositiveNumber(form.goldWeight21);
  const goldWeight24 = toPositiveNumber(form.goldWeight24);
  const pureGoldWeight24 = Number((((goldWeight18 * 18) + (goldWeight21 * 21) + (goldWeight24 * 24)) / 24).toFixed(4));
  const meetsNisab = pureGoldWeight24 >= 85;
  const formatSmall = (n) => new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 2 }).format(n);

  useEffect(() => {
    if (!isGoldCategory) return;
    const gramPrice = Number(goldPrice24k);
    const pureWeight = ((goldWeight18 * 18) + (goldWeight21 * 21) + (goldWeight24 * 24)) / 24;
    const nextValue = Number.isFinite(gramPrice) && gramPrice > 0 && pureWeight > 0
      ? Number((pureWeight * gramPrice).toFixed(2))
      : 0;
    setForm((prev) => {
      if (prev.value === nextValue && prev.currency === "EGP") return prev;
      return { ...prev, value: nextValue, currency: "EGP" };
    });
  }, [isGoldCategory, goldWeight18, goldWeight21, goldWeight24, goldPrice24k]);

  useEffect(() => {
    if (!isGoldCategory) return;
    setForm((prev) => {
      if (prev.goldWeight18 !== undefined || prev.goldWeight21 !== undefined || prev.goldWeight24 !== undefined) return prev;
      const gramPrice = Number(goldPrice24k);
      const inferred = Number(prev.value);
      if (!Number.isFinite(gramPrice) || gramPrice <= 0 || !Number.isFinite(inferred) || inferred <= 0) {
        return { ...prev, goldWeight18: "", goldWeight21: "", goldWeight24: "", currency: "EGP" };
      }
      return { ...prev, goldWeight18: "", goldWeight21: "", goldWeight24: Number((inferred / gramPrice).toFixed(2)), currency: "EGP" };
    });
  }, [isGoldCategory, goldPrice24k]);

  const updateCategory = (nextCategory) => {
    setForm((prev) => {
      if (nextCategory === "صناديق واستثمارات") {
        return {
          ...prev,
          category: nextCategory,
          zakatBasis: 0.25,
        };
      }
      if (nextCategory !== "معادن ثمينة") return { ...prev, category: nextCategory, zakatBasis: 1 };
      return {
        ...prev,
        category: nextCategory,
        currency: "EGP",
        zakatBasis: 1,
        goldWeight18: prev.goldWeight18 ?? "",
        goldWeight21: prev.goldWeight21 ?? "",
        goldWeight24: prev.goldWeight24 ?? "",
      };
    });
  };

  const updateGoldWeightByKarat = (field, rawWeight) => {
    setForm((prev) => {
      if (rawWeight === "") {
        return { ...prev, [field]: "" };
      }
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight) || weight < 0) {
        return { ...prev, [field]: rawWeight };
      }
      return { ...prev, [field]: weight };
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid2">
        <div><label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 6 }}>{tr("اسم الأصل", "Asset Name")}</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 6 }}>{tr("الفئة", "Category")}</label><select value={form.category} onChange={(e) => updateCategory(e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]?.[lang] || c}</option>)}</select></div>
      </div>
      <div className="grid2">
        <div>
          <label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 6 }}>
            {isGoldCategory ? tr("وزن الذهب (جرام)", "Gold Weight (grams)") : tr("القيمة", "Value")}
          </label>
          {isGoldCategory ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 4 }}>{tr("وزن الذهب عيار 18", "18K gold weight")}</label>
                <input type="number" min="0" step="0.01" value={form.goldWeight18 ?? ""} onChange={(e) => updateGoldWeightByKarat("goldWeight18", e.target.value)} placeholder={tr("جرام", "grams")} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 4 }}>{tr("وزن الذهب عيار 21", "21K gold weight")}</label>
                <input type="number" min="0" step="0.01" value={form.goldWeight21 ?? ""} onChange={(e) => updateGoldWeightByKarat("goldWeight21", e.target.value)} placeholder={tr("جرام", "grams")} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 4 }}>{tr("وزن الذهب عيار 24", "24K gold weight")}</label>
                <input type="number" min="0" step="0.01" value={form.goldWeight24 ?? ""} onChange={(e) => updateGoldWeightByKarat("goldWeight24", e.target.value)} placeholder={tr("جرام", "grams")} />
              </div>
            </div>
          ) : (
            <input type="number" value={form.value} onChange={(e) => set("value", +e.target.value)} />
          )}
        </div>
        {!isGoldCategory && (
          <div>
            <label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 6 }}>{tr("العملة", "Currency")}</label>
            <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {["EGP", "USD", "AED", "SAR", "EUR", "GBP", "KWD", "QAR", "JOD"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>
      {isGoldCategory && (
        <div style={{ fontSize: 12, color: Number(goldPrice24k) > 0 ? "#8B949E" : "#F85149", lineHeight: 1.7 }}>
          {Number(goldPrice24k) > 0
            ? tr(
                `الوزن الخالص (24): ${formatSmall(pureGoldWeight24)} جم — ${meetsNisab ? "بلغ النصاب (85 جم)" : "لم يبلغ النصاب (85 جم)"}. القيمة تُحسب تلقائيًا بسعر الجرام الحالي: ${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(goldPrice24k)} ج.م.`,
                `Pure 24K equivalent: ${formatSmall(pureGoldWeight24)} g — ${meetsNisab ? "Nisab reached (85g)" : "Below nisab (85g)"}. Value is auto-calculated using current gram price: ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(goldPrice24k)} EGP.`
              )
            : tr("لا يوجد سعر ذهب متاح الآن من API. حدّث السعر أولًا من لوحة القيادة.", "No gold price available from API. Refresh it first from Dashboard.")}
          <div style={{ marginTop: 6 }}>
            {tr("معادلة التحويل: (وزن العيار × العيار ÷ 24). تُحسب الزكاة بنسبة 2.5% بعد بلوغ النصاب ومرور الحول.", "Conversion formula: (Karat weight × karat ÷ 24). Zakat is 2.5% after reaching nisab and completing one lunar year.")}
          </div>
          <div style={{ marginTop: 10, border: "1px solid #2A3138", borderRadius: 10, padding: "10px 12px", background: "rgba(255,217,61,0.08)", color: "#FFD93D", fontWeight: 800 }}>
            {tr("القيمة الإجمالية", "Total Value")}: {formatSmall(Number(form.value || 0))} {tr("جنيه مصري", "EGP")}
          </div>
        </div>
      )}
      {isFundsCategory && (
        <div>
          <label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 6 }}>{tr("نسبة وعاء الزكاة (0-1)", "Zakat Basis (0-1)")}</label>
          <input type="number" step="0.05" min="0" max="1" value={form.zakatBasis || 1} onChange={(e) => set("zakatBasis", +e.target.value)} />
          <div style={{ fontSize: 12, color: "#E6EDF3", marginTop: 6, background: "rgba(255,217,61,0.10)", border: "1px solid rgba(255,217,61,0.25)", borderRadius: 8, padding: "8px 10px" }}>
            {tr("للأسهم طويلة الأجل: النطاق المقترح عادةً من 0.25 إلى 0.35 ويمكنك التعديل حسب حالتك.", "For long-term stocks/funds: the typical suggested range is 0.25 to 0.35, and you can adjust it based on your case.")}
            <div style={{ marginTop: 8 }}>
              <a
                href="https://fundingsouq.com/ae/ar/blog/zakat-on-investments-complete-guide-for-muslims-/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#FFD93D", fontWeight: 700, textDecoration: "underline" }}
              >
                {tr("مرجع: (٢- زكاة صناديق الاستثمار المشترك وصناديق الاستثمار المتداولة)", "Reference: (2) Zakat on Mutual Funds and Exchange-Traded Funds")}
              </a>
            </div>
          </div>
        </div>
      )}
      <div className="grid2">
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}><input type="checkbox" checked={form.zakatable} onChange={(e) => set("zakatable", e.target.checked)} style={{ width: "auto", accentColor: "#FFD93D" }} /><span style={{ fontSize: 14 }}>{tr("خاضع للزكاة", "Zakat Eligible")}</span></label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}><input type="checkbox" checked={form.cashFlow} onChange={(e) => set("cashFlow", e.target.checked)} style={{ width: "auto", accentColor: "#4ECDC4" }} /><span style={{ fontSize: 14 }}>{tr("تدفق نقدي", "Cash Flow")}</span></label>
      </div>
      <div><label style={{ fontSize: 12, color: "#8B949E", display: "block", marginBottom: 6 }}>{tr("ملاحظات", "Notes")}</label><input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel}>{tr("إلغاء", "Cancel")}</button>
        <button className="btn btn-gold" onClick={() => onSave(form)}>{isNew ? tr("إضافة", "Add") : tr("حفظ التعديلات", "Save Changes")}</button>
      </div>
    </div>
  );
}
