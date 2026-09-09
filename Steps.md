- SSH Target Oluştur (Wireguard sununcusunun buşunduğu remote hosting için)
- İlgili SSH Targetı kullanarak bir server Oluştur
- Devicesdan bütün cihazları Oluştur.
- Doğru configlerin servera apply edilmesi için Servers > Apply aksiyonunu kullan
Yukarıdaki adımlare sonrasında artık devicelar test edildiğinde okay dönüyor olmalı. Bütün bilgisayarların terminallerine bağlanabilmek, filelarını gezebilmek için her bir bilgisayar için kendi ipsi ile birer ssh target oluşturulmalı. (Buradaki ssh targetlar vpn içindeki ip ile kullanılacaklar)

- SSH Targets sayfası altında vpn ipleri ile targetlar oluşturulur.
- Targetların public keyleri ilgili makinelerin "authorized_keys" fileına yazılır.
Bu işlemlerden sonra makinelere app üzerinden erişilebilir.