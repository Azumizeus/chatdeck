// OCR Vision via JXA (init par URL, sans ImageIO). Usage: osascript -l JavaScript /tmp/ocr-vision.js <img...>
ObjC.import('Vision');

function run(argv) {
  var out = [];
  for (var i = 0; i < argv.length; i++) {
    var p = argv[i];
    try {
      var url = $.NSURL.fileURLWithPath(p);
      var req = $.VNRecognizeTextRequest.alloc.init;
      req.recognitionLevel = 1; // VNRequestTextRecognitionLevelAccurate
      req.recognitionLanguages = $(['fr-FR', 'en-US']);
      req.usesLanguageCorrection = true;

      var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());
      var ok = handler.performRequestsError($.NSArray.arrayWithObject(req), null);

      var lines = [];
      var res = req.results;
      if (res) {
        for (var j = 0; j < res.count; j++) {
          var obs = res.objectAtIndex(j);
          var cand = obs.topCandidates(1).objectAtIndex(0);
          lines.push(String(ObjC.unwrap(cand.string)));
        }
      }
      out.push('=== ' + p + ' ===\n' + (ok ? lines.join('\n') : '<erreur OCR perform>'));
    } catch (e) {
      out.push('=== ' + p + ' ===\n<exception: ' + e.message + '>');
    }
  }
  return out.join('\n');
}
