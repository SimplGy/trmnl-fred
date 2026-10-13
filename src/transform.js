function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function shortDate(ms) {
  var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var d = new Date(ms);
  return m[d.getUTCMonth()] + " " + d.getUTCFullYear();
}

function median(values) {
  var s = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  if (!s.length) return 0;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function missing(id) {
  return { id: id, title: id, error: true, points: [], min: 0, max: 0, median: 0 };
}

async function run(input) {
  var out = { charts: [], chart_count: 0, error: null };

  try {
    // one polling URL lands at the top level, several land under IDX_0, IDX_1...
    var meta = (input && input.IDX_0) ? input.IDX_0 : (input || {});
    var seriesList = Array.isArray(meta.chart_series) ? meta.chart_series : [];

    var cf = (input && input.trmnl && input.trmnl.plugin_settings &&
      input.trmnl.plugin_settings.custom_fields_values) || {};

    // the configured slots, in order, blanks removed
    var wanted = [];
    for (var k = 1; k <= 4; k++) {
      var slot = cf["series_" + k];
      if (slot && String(slot).trim()) wanted.push(String(slot).trim().toUpperCase());
    }

    if (!seriesList.length && !wanted.length) {
      out.error = "FRED returned no data.";
      return out;
    }

    var MAX_POINTS = 90;

    var fetched = await Promise.all(seriesList.map(async function (s) {
      var objects = s.series_objects ? Object.values(s.series_objects) : [];
      var obj = objects.length ? objects[0] : {};
      var id = (s.graph_series_ids && s.graph_series_ids[0]) || obj.series_id || null;
      if (!id) return null;

      try {
        // no cosd/coed: FRED returns the full history for the series
        var url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + encodeURIComponent(id);
        var res = await fetch(url);
        if (!res.ok) return missing(id);
        var text = await res.text();

        var rows = [];
        var vals = [];
        var lines = text.split(/\r?\n/);
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i];
          if (!line) continue;
          var comma = line.indexOf(",");
          if (comma < 1) continue;
          var dateStr = line.slice(0, comma).trim();
          var value = parseFloat(line.slice(comma + 1));
          if (!dateStr || !isFinite(value)) continue;
          var ms = Date.parse(dateStr + "T00:00:00Z");
          if (!isFinite(ms)) continue;
          rows.push([ms, value]);
          vals.push(value);
        }
        if (!rows.length) return missing(id);

        var points = rows;
        if (rows.length > MAX_POINTS) {
          var step = (rows.length - 1) / (MAX_POINTS - 1);
          points = [];
          for (var k2 = 0; k2 < MAX_POINTS; k2++) {
            points.push(rows[Math.round(k2 * step)]);
          }
          points[points.length - 1] = rows[rows.length - 1];
        }

        var last = rows[rows.length - 1];
        var prev = rows.length > 1 ? rows[rows.length - 2] : null;

        return {
          id: id,
          title: s.title || obj.title || id,
          units: obj.units_short || "",
          frequency: s.frequency || obj.frequency || "",
          points: points,
          latest: round3(last[1]),
          latest_date: isoDay(last[0]),
          latest_label: shortDate(last[0]),
          first_label: shortDate(rows[0][0]),
          change: prev ? round3(last[1] - prev[1]) : 0,
          min: round3(Math.min.apply(null, vals)),
          max: round3(Math.max.apply(null, vals)),
          median: round3(median(vals)),
          observations: rows.length
        };
      } catch (e) {
        return missing(id);
      }
    }));

    // keep the user's slot order, and give every configured id a slot even
    // when FRED returned nothing for it (bad id, delisted series, fetch error)
    var byId = {};
    fetched.forEach(function (c) {
      if (c && c.id) byId[String(c.id).toUpperCase()] = c;
    });

    var ordered = [];
    wanted.forEach(function (id) {
      ordered.push(byId[id] || missing(id));
    });
    fetched.forEach(function (c) {
      if (c && c.id && wanted.indexOf(String(c.id).toUpperCase()) === -1) ordered.push(c);
    });

    out.charts = ordered;
    out.chart_count = ordered.length;

    var live = ordered.filter(function (c) { return !c.error; });
    if (!live.length) {
      out.error = "FRED returned no data.";
    }
  } catch (e) {
    out.error = "FRED data error: " + String((e && e.message) || e);
  }

  return out;
}
