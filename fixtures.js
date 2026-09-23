// Fixtures shaped like a real Open-Meteo response.
function pad(n) { return (n < 10 ? "0" : "") + n; }

function make(opts) {
  var date = opts.date;              // "2026-06-21"
  var sunrise = opts.sunrise;        // "04:15"
  var sunset = opts.sunset;          // "20:50"
  var days = opts.days || 9;

  var hourly = { time: [], temperature_2m: [], weather_code: [],
                 precipitation_probability: [], wind_speed_10m: [] };

  var base = new Date(date + "T00:00:00Z");
  for (var d = 0; d < days; d++) {
    var cur = new Date(base.getTime() + d * 86400000);
    var iso = cur.toISOString().slice(0, 10);
    for (var h = 0; h < 24; h++) {
      hourly.time.push(iso + "T" + pad(h) + ":00");
      hourly.temperature_2m.push(10 + h * 0.5 + d);
      hourly.weather_code.push(h % 5 === 0 ? 61 : 2);
      hourly.precipitation_probability.push((h * 4) % 100);
      hourly.wind_speed_10m.push(5 + (h % 7));
    }
  }

  var daily = { time: [], weather_code: [], temperature_2m_max: [],
                temperature_2m_min: [], precipitation_probability_max: [],
                wind_speed_10m_max: [], sunrise: [], sunset: [] };

  for (var i = 0; i < days; i++) {
    var dt = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    daily.time.push(dt);
    daily.weather_code.push([0, 2, 61, 71, 95, 3][i % 6]);
    daily.temperature_2m_max.push(18.4 + i);
    daily.temperature_2m_min.push(9.2 + i);
    daily.precipitation_probability_max.push(10 + i * 12);
    daily.wind_speed_10m_max.push(12.6 + i);
    daily.sunrise.push(dt + "T" + sunrise);
    daily.sunset.push(dt + "T" + sunset);
  }

  return {
    current: {
      time: date + "T12:00",
      temperature_2m: 17.6,
      weather_code: 2,
      wind_speed_10m: 14.3,
      precipitation: 0.2
    },
    hourly: hourly,
    daily: daily
  };
}

module.exports = {
  summer: make({ date: "2026-06-21", sunrise: "04:15", sunset: "20:50" }),
  winter: make({ date: "2025-12-21", sunrise: "07:20", sunset: "15:40" }),
  make: make
};
