// Mentari WA Notifier
// Detect incomplete items and new assignments; send to n8n webhook

(function () {
  const STORAGE = {
    LAST_SENT_HASH: "wa_notifier_last_hash",
  };

  function getBool(key, def = false) {
    const v = localStorage.getItem(key);
    if (v === null) return def;
    return v === "true";
  }

  function getString(key, def = "") {
    const v = localStorage.getItem(key);
    return v == null ? def : v;
  }

  function sha1(input) {
    // lightweight hash for dedupe (not crypto-strong)
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  function extractIncompleteFromCourseData(courseDataList) {
    const items = [];
    if (!Array.isArray(courseDataList)) return items;
    courseDataList.forEach((course) => {
      const kode = course?.kode_course || course?.kodeCourse || course?.kode_course_section || "";
      const courseName = course?.coursename || course?.course_name || "Mata Kuliah";
      const sections = course?.section || course?.sections || course?.data || [];
      sections.forEach((section) => {
        const sectionName = section?.nama_section || section?.name || section?.title || "Pertemuan";
        const sub = section?.sub_section || section?.items || [];
        sub.forEach((it) => {
          const completed = !!it?.completion;
          if (completed) return;
          const type = it?.kode_template || it?.type || "ITEM";
          const title = it?.judul || it?.title || it?.name || type;
          let url = it?.link || "";
          // Build URLs for known templates when possible
          if (!url) {
            if ((type === "PRE_TEST" || type === "POST_TEST") && it?.id && kode) {
              url = `https://mentari.unpam.ac.id/u-courses/${kode}/exam/${it.id}`;
            } else if (type === "FORUM_DISKUSI" && it?.id && kode) {
              url = `https://mentari.unpam.ac.id/u-courses/${kode}/forum/${it.id}`;
            } else if (type === "KUESIONER" && section?.kode_section && kode) {
              url = `https://mentari.unpam.ac.id/u-courses/${kode}/kuesioner/${section.kode_section}`;
            }
          }
          items.push({ courseName, kodeCourse: kode, sectionName, type, title, url });
        });
      });
    });
    return items;
  }

  function formatMessage(user, items) {
    const name = user?.fullname || user?.name || user?.username || "Mahasiswa";
    if (!items?.length) return `Tidak ada tugas tertunda untuk ${name}.`;
    const lines = [
      `Halo ${name}, ada ${items.length} item belum selesai:`,
      ...items.slice(0, 20).map((it, idx) => {
        const pertemuan = it.sectionName || "Pertemuan";
        const kind = it.type;
        const title = it.title;
        const link = it.url ? `\n- Link: ${it.url}` : "";
        return `${idx + 1}. [${pertemuan}] ${kind} - ${title}${link}`;
      }),
    ];
    if (items.length > 20) lines.push(`Dan ${items.length - 20} lagi...`);
    return lines.join("\n");
  }

  async function sendToWebhook(payload) {
    const url = getString("wa_notifier_webhook");
    if (!url) return false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (e) {
      console.error("WA Notifier webhook error", e);
      return false;
    }
  }

  function getUserInfo() {
    try {
      const raw = localStorage.getItem("mentari_user_info");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function getCachedCourses() {
    try {
      const raw = localStorage.getItem("mentari_course_data");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  async function evaluateAndNotify(sourceTag) {
    if (!getBool("wa_notifier_enabled")) return;
    const phone = getString("wa_notifier_phone").trim();
    if (!phone) return;
    const user = getUserInfo();
    const data = getCachedCourses();
    if (!data || !Array.isArray(data) || data.length === 0) return;

    const includeIncomplete = getBool("wa_notify_incomplete", true);
    const incomplete = includeIncomplete ? extractIncompleteFromCourseData(data) : [];

    const message = formatMessage(user, incomplete);
    const fingerprint = sha1([phone, message].join("|"));
    const last = localStorage.getItem(STORAGE.LAST_SENT_HASH);
    if (last === fingerprint) return; // prevent duplicates

    const payload = {
      type: "incomplete_summary",
      phone,
      user: { name: user?.fullname, nim: user?.username },
      source: sourceTag,
      count: incomplete.length,
      items: incomplete,
      message,
      timestamp: new Date().toISOString(),
    };

    const ok = await sendToWebhook(payload);
    if (ok) localStorage.setItem(STORAGE.LAST_SENT_HASH, fingerprint);
  }

  // Public API to hook from token.js
  window.MentariNotifier = {
    bootstrap() {
      // Run once after page ready
      setTimeout(() => evaluateAndNotify("bootstrap"), 2000);
    },
    onCourseDataUpdated() {
      evaluateAndNotify("course_update");
    }
  };
})();


