# Leave Requests

מערכת לניהול בקשות חופשה של עובדים, הגשת בקשות ואישורן, עם בדיקת יתרה וחפיפות בין תאריכים.

## דרישות

- Docker עם Docker Compose עבור מסד הנתונים והשרת.
- Node.js 20 ו־npm עבור ממשק המשתמש (Angular 17).
- להרצת השרת מחוץ ל־Docker: Java 21 ו־Maven 3.9.

## הרצה עם Docker

שכפלו את המאגר ועברו לתיקיית הפרויקט:

```sh
git clone https://github.com/michalgal94/leave-requests.git
cd leave-requests
```

הפעילו את PostgreSQL ואת שרת ה־API משורש הפרויקט:

```sh
docker compose up --build -d
```

הפעילו את ממשק המשתמש בטרמינל נוסף:

```sh
cd frontend
npm ci
npm start
```

| שירות | כתובת |
| --- | --- |
| ממשק המשתמש | http://localhost:4200 |
| API | http://localhost:5080/api |
| תיעוד Swagger | http://localhost:5080/swagger-ui.html |

Docker Compose מפעיל את מסד הנתונים ואת ה־API בלבד. ממשק המשתמש מופעל בנפרד באמצעות npm.

## הרצת השרת ללא Docker

הפעילו רק את מסד הנתונים משורש הפרויקט:

```sh
docker compose up -d db
```

בטרמינל נוסף, הפעילו את השרת באמצעות Java 21 ו־Maven:

```sh
cd backend
mvn spring-boot:run
```

לאחר מכן הפעילו את ממשק המשתמש לפי ההוראות למעלה. אם שרת ה־API כבר פועל ב־Docker, עצרו אותו תחילה עם `docker compose stop api` כדי לפנות את פורט 5080.

## בדיקות ובנייה

בדיקות השרת משתמשות ב־Testcontainers ודורשות Docker פעיל:

```sh
cd backend
mvn test
```

בדיקות ממשק המשתמש דורשות התקנת התלויות ודפדפן Chrome:

```sh
cd frontend
npm ci
npm test -- --watch=false --browsers=ChromeHeadless
```

לבניית ממשק המשתמש:

```sh
cd frontend
npm run build
```

## מידע חשוב

- מסד הנתונים הוא PostgreSQL 16, בפורט 5432. שם המסד, המשתמש והסיסמה בסביבת הפיתוח הם `leave`.
- הנתונים נשמרים ב־Docker volume בשם `pgdata` גם לאחר עצירת השירותים. נתוני דוגמה נטענים באמצעות `DataSeeder`.
- הסביבה המקומית פועלת ללא התחברות והרשאות משתמשים. ה־API ומסד הנתונים מוגבלים כברירת מחדל למחשב המקומי.
- ממשק המשתמש פונה ל־`http://localhost:5080/api`, והשרת מאפשר בקשות מהמקור `http://localhost:4200`. שינוי כתובות או פורטים דורש התאמה ב־`LeaveRequestsApiService` וב־`WebConfig`.
- ניתן לשנות את חיבור מסד הנתונים באמצעות `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` ו־`SPRING_DATASOURCE_PASSWORD`.

לצפייה בלוגים, הריצו משורש הפרויקט:

```sh
docker compose logs -f api
```

לעצירת שירותי Docker בלי למחוק את הנתונים:

```sh
docker compose down
```

לעצירת ממשק המשתמש לחצו `Ctrl+C` בטרמינל שבו פועל `npm start`.
