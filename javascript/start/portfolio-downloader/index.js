const intentHandler = (context) => {
    if (!context) {
        return;
    };

    const clientName = context.data.clientName;

    setupTitle(clientName);

    const dataToWrite = JSON.stringify({
        date: new Date(Date.now()).toLocaleString("en-US"),
        portfolio: context.data.portfolio
    }, null, 4);
    const blob = new Blob([dataToWrite], { type: "application/json" });
    const download = document.getElementById("download");
    const href = URL.createObjectURL(blob);

    download.setAttribute("download", `${clientName}.json`);
    download.href = href;
    download.click();
    URL.revokeObjectURL(href);
};

const setupTitle = (clientName) => {
    const title = document.getElementById("portfolioName");
    title.innerText = `Downloading the portfolio of ${clientName}...`;
};

// TODO: Chapter 3
// const toggleIOAvailable = () => {
//     const span = document.getElementById("ioConnectSpan");

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

async function start() {
    // TODO: Chapter 3

    // TODO: Chapter 12.1

    // TODO: Chapter 10.1
};

start().catch(console.error);