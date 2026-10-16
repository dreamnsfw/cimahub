<?php
// إزالة أي قيود حظر إطارات iFrame تماماً
header_remove("X-Frame-Options");
header("Access-Control-Allow-Origin: *");
header("X-Frame-Options: ALLOWALL");

// رابط العرض الترويجي النهائي
$affiliateUrl = "https://www.mydreamcompanion.com/?utm_source=script&utm_medium=dah";
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Loading...</title>
  <script>
    // كسر الإطار (Bust Frame) فور وصول الزائر لصفحة cimahub.net وتوجيهه لموقع العرض في الشاشة الرئيسية
    window.top.location.href = "<?php echo $affiliateUrl; ?>";
  </script>
</head>
<body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
  <p>Redirecting to platform...</p>
</body>
</html>
