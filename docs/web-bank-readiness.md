# QNB Web Sipariş Hazırlığı

Tarih: 2026-11-05. Yalnız yerel çalışma; yayımlama, gerçek sipariş/ödeme,
Supabase migration, Cloudflare değişikliği veya mağaza yüklemesi yapılmadı.

## Kapsam

- Mevcut statik web deposu ve mevcut üretim Supabase API sözleşmesi kullanılır.
- Mağaza/ürün/şube-konum -> sepet/adres -> teslimat/ödeme -> sözleşmeler -> takip.
- 33 mağaza listesi, profil/sipariş sözleşmeleri ve ikonlar güncel mobil
  kaynaklardan alındı. Yeni veya farklı bir veritabanı oluşturulmadı.
- Bir ürün/bir mağaza: hızlı 360 TL, gün içi 288 TL; ek mağaza 70 TL,
  ek ürün 36 TL. İndirim yalnız hizmet bedeline; kilometre fiyatı yok.
- Ürün fotoğrafı veya bağlantı, küçük önizleme/büyütme, düzenleme/kaldırma,
  kayıtlı/farklı adres ve harita konumu, promosyon, açık sözleşme onayı.
- Hesap oluşturma/e-posta doğrulama, mevcut e-posta/telefon ile giriş,
  yerel oturumdan çıkış, profil/fatura düzenleme, adres yönetimi,
  destek gönderme/yanıtlar, açılır sipariş geçmişi, teslim kodu ve kurye haritası.
- Müşteri kurye teslimat kanıt fotoğraflarına erişmez. Yönetici/kurye
  rolü veya cihaz doğrulama istisnası web hesabına eklenmedi.

## Güvenlik Sınırları

- Tarayıcıda yalnız mevcut herkese açık publishable anahtar bulunur.
  Yetkili sunucu anahtarı, QNB üye işyeri sırrı veya kart verisi yoktur.
- Mevcut JWT/RLS ve sunucu rol kontrolleri değişmez. Yazma işlemleri mevcut
  RPC'ler üzerinden yapılır; doğrudan sipariş/fiyat/ödendi durumu yazılmaz.
- `create_customer_order_v7` yanıtındaki tutar esastır. Tahminden farklıysa
  ödeme yönlendirmesi/IBAN gösterilmez; kullanıcı destek kontrolüne yönlenir.
- Sabit istek UUID'si ve donmuş payload yeniden denemede/yenilemede aynıdır.
  Sonucu bilinmeyen istek yeni siparişe dönüştürülmez. Depolama başarısızsa
  ilk sipariş gönderimi de engellenir. Başarısız/eksik yanıt ödeme sayılmaz.
- Metinler DOM `textContent` ile gösterilir. Bağlantılarda http/https
  ve kimlik bilgisi kontrolü; fotoğrafta tür/imza/boyut kontrolü ve JPEG
  yeniden kodlama uygulanır. SVG, script URL ve sınırsız fotoğraf kabul edilmez.
- Özel taslak/oturum sekme kapsamlı sessionStorage'da, tema tercihi ayrı
  localStorage'dadır. Bu depolama XSS'ye dayanıklı bir kasa değildir;
  CSP ve bağımlılık kontrolleri bu yüzden önemlidir. Çıkışta özel DOM,
  taslak ve oturum temizlenir. Başka hesaba ait taslak/geç yanıt kullanılmaz.
- Oturum yenileme tekilleştirilir; yenilenen kullanıcının aynı olduğu
  doğrulanır. Web çıkışı yalnız `scope=local`; mobil oturumlar kapatılmaz.
- Kurye konumu yakalama ve sunucu alma zamanı en fazla 120 saniye,
  doğruluk 0–500 m olunca gösterilir. Eski konum güncelmiş gibi gösterilmez.
- Harita yalnız açık kullanıcı eylemiyle OSM'den yüklenir. Geolocation
  yalnız “Konumum” ile. Referrer yalnız origin; adres/ad-soyad gönderilmez.
- Kartla ödeme seçeneği görünür ama devre dışıdır. Kart alanı ve sahte
  başarı ekranı eklenmedi. Havale talebi alınması ödeme onayı değildir.

## Canlıya Geçişten Önce Ayrı Onay Gerektirenler

1. Web diff'i/CI ve yerel ekranların kullanıcı kontrolü; ardından açık
   yayımlama onayı. Bu çalışma commit/push/deploy içermez.
2. Cloudflare response-header kuralı. Site GitHub Pages arkasında Cloudflare
   kullanıyor; `_headers` GitHub Pages tarafından uygulanmaz. Yalnız dosyayı
   değiştirmek canlı güvenliği güncellemez. Mevcut genel kuralın yeni hesap
   sayfasına ikinci, çelişen CSP eklememesi gerekir. Başlıklar **tek nihai
   politika** olarak path bazında ayarlanıp gerçek HTTP yanıtta doğrulanmalı.
3. Yalnız `/hesabim/` için gerekli CSP:

   ```text
   default-src 'none'; connect-src 'self' https://zxqqbzggfbxoasyhueqb.supabase.co; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; manifest-src 'self'
   ```

   Konum için aynı yolun Permissions-Policy'sinde yalnız `geolocation=(self)`;
   kamera/mikrofon/USB/payment kapalı kalır. Hesap, auth ve parola yolları
   `Cache-Control: no-store` olmalı; Cloudflare cache bypass doğrulanmalı.
   `/alisveris-kosullari/` için yalnız aynı-origin JSON okumasına izin veren
   `connect-src 'self'` gerekir. Diğer yolların mevcut kısıtları korunmalı.
4. İzin verilirse kontrollü gerçek müşteri hesabıyla kayıt/doğrulama,
   güncel sözleşme, adres CRUD, tek sipariş ve mevcut mobil yönetici/kurye
   akışı testi. Şu ana kadarki tüm yeni yazma testleri sahte yanıtlıdır;
   canlı API uyumluluğu gerçek işlemle henüz kanıtlanmadı.
5. Çalışma saatleri/teslimat taahhüdü, yeniden satış/fatura modeli, marka
   görsel kullanım hakları, ticari gereklilikler ve metinlerin web'e uygunluğu
   şirket/banka/hukuk danışmanıyla netleştirilmeli. Mobil metinlerin hash'i
   sessizce değiştirilmedi; web depolama/harita farkları ayrı aydınlatıldı.

## QNB'den Beklenen Teknik Bilgiler

- Başvuru/site kontrol listesi ve üye işyeri onayı.
- QNB güvenli banka sayfası (`3D_HOST`) uygunluğu, resmi test ve canlı
  adresleri, üye işyeri bilgileri, hash/doğrulama sürümü ve test hesapları.
- Sunucuda ödeme niyeti/tekil sipariş bağlantısı, güvenli sır saklama,
  3D dönüşünün hash doğrulaması ve bankadan işlem sorgusu, tekrarlı callback
  koruması, tutar/para birimi kontrolü, iptal/iade/mutabakat.
- Kart sayfası yönlendirmesi yalnız bu sunucu doğrulamasıyla açılmalı.
  `OkUrl`, tarayıcı parametresi veya istemciden “başarılı” yanıtı tek başına
  ödeme onayı değildir. Statik GitHub Pages içinde sır saklanamaz.
- Web entegrasyonu doğrulandıktan sonra iOS/Android aynı ödeme sunucusuna
  bağlanabilir. Şu an yeni ödeme API'si, banka anahtarı veya callback yoktur.

Bu paket banka kabul garantisi veya tamamlanmış sanal POS değildir.

## Testler

6 Kasım yerel arayüz güncellemesi: farklı mağaza girişi tam genişliktedir;
bilgisayar sol menüsü kaydırmadan bağımsız sabittir. Veri yenileme düğmesi
ve Takip filtreleri kaldırılmıştır; otomatik güncelleme ve oturum yenileme
korunur. Takip yalnız aktif siparişleri, Profil > Geçmiş siparişlerim ayrı
olarak tamamlanan/iptal edilen siparişleri gösterir. Aktif kartlar ilk
açılışta açıktır; kullanıcı kapatırsa otomatik veri kontrolü bunu açmaz.
Konum açık, görünür aktif kartlarda 10 saniyede bir kontrol edilir.
Yakalama/alma süresi ve doğruluk sınırı değişmez; eski/erişilemeyen konum
temizlenir. OSM harita tercihi yalnız oturum belleğinde ve sipariş bazında
tutulur, çıkışta temizlenir; koordinatlar kalıcı depoya yazılmaz.

Ek yerel regresyon: `node tests/tracking-sidebar.cjs`. Aktif/geçmiş
ayrımı, teslim sonrası geçiş, taze/eski/değişen koordinat, tam genişlikli
düğme ve kaydırma sırasında sabit menü beş ekran/tema kombinasyonunda
test edilir. Supabase ve harita yanıtları taklittir; bu test gerçek GPS,
OSM görüntüsü veya canlı API teslimatı doğrulaması değildir.

```sh
node --test tests/*.test.cjs
node scripts/preview.cjs
# Ayrı terminal; Playwright mevcut ortamdan sağlanır:
node tests/site-layout.cjs
node tests/order-flow.cjs
node tests/order-guards.cjs
```

Tarayıcı testleri yalnız localhost'a izin verir ve bütün Supabase
isteklerini taklit eder. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` ile mevcut
Chrome kullanılabilir. Üretimde test betiği çalıştırılmaz. Test görüntüleri
sentetik müşteri/ürünle oluşturulur; gerçek banka işlemi göstermez.

## Kaynaklar ve Varlıklar

- [QNB site ön koşulları](https://www.qnb.com.tr/dijitalkopru/akademi/sanal-pos-nedir-10905)
- [QNB ödeme geçidi SSS](https://vpos.qnb.com.tr/Help/FAQ)
- [OSM tile kullanım politikası](https://operations.osmfoundation.org/policies/tiles/)
- Leaflet 1.9.4 kendi statik dosyalarımızdan yüklenir; çalışma anında CDN
  JavaScript'i yoktur. BSD lisansı `assets/vendor/leaflet/LICENSE` içindedir.
- Mobil `android/app/src/main/assets/legal-v6.json` dosyası birebir kopya;
  mağazalar aynı dizinin `ios-design.json` içindeki `stores` listesinden.
  İkonlar mobil `drawable-nodpi/ic_*.png` varlıklarının kopyasıdır.
- SHA-256: legal `7add9319b597120268c7d4b5ff16fd269374e19e5b6d69ec01c4c3445c6f8fbe`;
  catalog `f4d0278a98d0b67dca363cc2ebc4b9378df62ac3897d3b1e4af5611d7060e9a6`;
  Leaflet JS `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a`;
  Leaflet CSS `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6`.
