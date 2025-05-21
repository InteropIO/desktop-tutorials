interface IntentContext {
    data: {
        clientName: string;
        portfolio: Stock[];
    };
}

const intentHandler = (context: IntentContext | null): void => {
    if (!context) {
        return;
    }

    setupTitle(context.data.clientName);

    const dataToWrite = JSON.stringify({
        date: new Date(Date.now()).toLocaleString("en-US"),
        portfolio: context.data.portfolio
    }, null, 4);
    const blob = new Blob([dataToWrite], { type: "application/json" });
    const download = document.getElementById("download") as HTMLAnchorElement;
    if (!download) return;
    
    const href = URL.createObjectURL(blob);

    download.href = href;
    download.click();
    URL.revokeObjectURL(href);
};

const setupTitle = (clientName: string): void => {
    const title = document.getElementById("portfolioName");
    if (!title) return;
    
    title.innerText = `Downloading the portfolio of ${clientName}...`;
};

// TODO: Chapter 3
// const toggleIOAvailable = (): void => {
//     const span = document.getElementById("ioConnectSpan");
//     if (!span) return;

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

async function start(): Promise<void> {
    // TODO: Chapter 3

    // TODO: Chapter 12.1

    // TODO: Chapter 10.1
}

// Add window properties when needed
declare global {
    interface Window {
        io?: IODesktopAPI;
    }
}

start().catch(console.error);