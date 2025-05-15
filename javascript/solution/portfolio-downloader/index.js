const intentHandler = (context) => {
    if (!context) {
        return;
    };

    setupTitle(context.data.clientName);

    const dataToWrite = JSON.stringify({
        date: new Date(Date.now()).toLocaleString("en-US"),
        portfolio: context.data.portfolio
    }, null, 4);
    const blob = new Blob([dataToWrite], { type: "application/json" });
    const download = document.getElementById("download");
    const href = URL.createObjectURL(blob);

    download.href = href;
    download.click();
    URL.revokeObjectURL(href);
};

const setupTitle = (clientName) => {
    const title = document.getElementById("portfolioName");
    title.innerText = `Downloading the portfolio of ${clientName}...`;
};

// TODO: Chapter 3
const toggleIOAvailable = () => {
    const span = document.getElementById("ioConnectSpan");

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

async function start() {
    const html = document.documentElement;
    const initialTheme = iodesktop.theme;

    html.className = initialTheme;

    // TODO: Chapter 3
    const io = await IODesktop();

    window.io = io;

    toggleIOAvailable();

    // TODO: Chapter 12.1
    const themeHandler = (newTheme) => {
        html.className = newTheme.name;
    };

    io.themes.onChanged(themeHandler);

    // TODO: Chapter 10.1
    io.intents.register("ExportPortfolio", intentHandler);
};

start().catch(console.error);