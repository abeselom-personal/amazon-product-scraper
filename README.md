# Amazon Product Scraper

Amazon Product Scraper is a full-stack application that allows users to search for products in real-time across different regional Amazon websites. The frontend is built with vanilla HTML, CSS, and JavaScript, using Vite as a build tool, while the backend is developed in Node.js with Express to handle the web scraping logic.

![InitialPage](https://github.com/marcub/amazon-product-scraper/blob/main/images/project1.png)

![Products](https://github.com/marcub/amazon-product-scraper/blob/main/images/project2.png)

![Pagination](https://github.com/marcub/amazon-product-scraper/blob/main/images/project3.png)


## Features

- **Keyword Search**: Allows users to enter a keyword to search for products.
- **Region Selection**: Provides a dropdown to choose from different Amazon domains (USA, Brazil, Spain, etc.).
- **Real-time Scraping**: The backend fetches and parses data directly from Amazon at the time of the request, ensuring up-to-date information.
- **Functional Pagination**: Scrapes and implements the search results' pagination, allowing users to navigate through pages.
- **Responsive UI**: A clean and minimalist user interface that adapts to different screen sizes.

## Technologies Used

- **Frontend**:
  - HTML5
  - CSS3
  - JavaScript (Vanilla)
  - Vite.js (Development environment and build tool)

- **Backend**:
  - Node.js
  - Express.js
  - Axios (For HTTP requests)
  - JSDOM (For server-side DOM manipulation)
  - Nodemon (For development)

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (version 14 or higher)
- npm (usually comes with Node.js)

## Installation

Follow the steps below to set up and run the project locally:

### 1. Clone the Repository
```bash
git clone https://github.com/marcub/amazon-product-scraper
cd amazon-product-scrape
```

### 2. Set Up the Backend (Server)
1. Navigate to the server directory:
   ```bash
   cd server
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the server in development mode (with Nodemon):
   ```bash
   npm run dev
   ```
   The server will be running at `http://localhost:3000`.

### 3. Set Up the Frontend (Client)
1. In a separate terminal, navigate to the client directory:
   ```bash
   cd client
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend will be running at `http://localhost:5173`.

### 4. Access the Application
- Open your browser and go to `http://localhost:5173`.
- The product search interface will be ready to use.

## Project Structure

- **`/client`**: Contains the frontend application.
  - `index.html`: The main structure of the page.
  - `/src/main.js`: Client-side logic for API interaction and data rendering.
  - `/src/style.css`: UI styling.
  - `vite.config.js`: Vite configuration, including the proxy to the backend.

- **`/server`**: Contains the backend application.
  - `/src/controllers`: Business logic (e.g., `scrape.controller.js` for scraping).
  - `/src/routes`: API route definitions (e.g., `api.routes.js`).
  - `/src/server.js`: Entry point and configuration for the Express server.

## License

Este projeto está licenciado sob a [Licença MIT](LICENSE).