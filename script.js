let appData = null;
let userDetails = {};
let lastQuery = { day: null, time: null, findNext: false };

// --- DATA LOADING ---
async function loadData() {
    try {
        const [ttResponse, teachersResponse, roomsResponse] = await Promise.all([
            fetch('./timetable.json'),
            fetch('./teachers.json'),
            fetch('./rooms.json')
        ]);
        if (!ttResponse.ok || !teachersResponse.ok || !roomsResponse.ok) {
            throw new Error('One or more data files not found.');
        }
        appData = {
            timetable: await ttResponse.json(),
            teachers: await teachersResponse.json(),
            rooms: await roomsResponse.json()
        };
    } catch (error) {
        console.error("Failed to load data files:", error);
        document.getElementById('result-text').innerHTML = `<span class="text-red-500">Error: Could not load data files. Make sure timetable.json, teachers.json, and rooms.json are in the same folder.</span>`;
    }
}

// --- UTILITY FUNCTIONS ---
const getTeacherName = (id) => appData.teachers.find(t => t.id === id)?.name || id || 'N/A';
const getRoomInfo = (ids) => ids ? ids.join(' or ') : 'N/A';

// --- CORE LOGIC ---
function findLectureStatus(day, time, findNext = false) {
    if (!userDetails.division) return { status: 'NO_DIVISION' };
    
    const scheduleToday = appData.timetable
        .filter(lec => lec.divisions.includes(userDetails.division) && lec.day === day)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

    if (scheduleToday.length === 0) return { status: 'NO_LECTURES_TODAY' };

    const personalStartTime = scheduleToday[0].startTime;
    const personalEndTime = scheduleToday[scheduleToday.length - 1].endTime;

    if (time < personalStartTime) return { status: 'COLLEGE_CLOSED_EARLY', nextLec: scheduleToday[0] };
    if (time > personalEndTime) return { status: 'COLLEGE_CLOSED_LATE' };

    const nextLecture = scheduleToday.find(lec => time < lec.startTime);

    if (findNext) {
        return nextLecture ? { status: 'FOUND_NEXT', lecture: nextLecture } : { status: 'NO_MORE_LECTURES' };
    }

    const currentLectures = scheduleToday.filter(lec => time >= lec.startTime && time < lec.endTime);

    if (currentLectures.length === 0) {
        return { status: 'IN_BREAK', nextLec: nextLecture };
    }

    let applicableLec = null;

    // --- UNIFIED LOGIC FOR ALL LECTURE TYPES ---
    // 1. Prioritize specific batch lectures (labs)
    applicableLec = currentLectures.find(lec => 
        !lec.type && lec.batches && lec.batches.length === 1 && userDetails.labBatch === lec.batches[0]
    );

    // 2. If no specific lab, check for choices (tutorial, elective, minor)
    if (!applicableLec && ['tutorial', 'elective', 'minor'].includes(currentLectures[0].type)) {
        const choiceType = currentLectures[0].type;
        let groupId;
        if (choiceType === 'elective') groupId = currentLectures[0].electiveGroup;
        else if (choiceType === 'minor') groupId = currentLectures[0].minorGroup;
        else if (choiceType === 'tutorial') groupId = currentLectures[0].subject; // Use subject as group ID for tutorials

        const userChoice = userDetails.choices ? userDetails.choices[groupId] : null;

        if (userChoice) {
            if (userChoice === 'NONE') return { status: 'IN_BREAK', nextLec: nextLecture };
            if (choiceType === 'tutorial') {
                applicableLec = currentLectures.find(lec => lec.batches.includes(userChoice));
            } else {
                applicableLec = currentLectures.find(lec => lec.subject === userChoice || lec.customGroup === userChoice);
            }
        } else {
            return { status: 'CHOICE_REQUIRED', options: currentLectures };
        }
    }

    // 3. If still no match, check for common lectures
    if (!applicableLec) {
        applicableLec = currentLectures.find(lec => 
            !lec.type && lec.batches && lec.batches.length > 1
        );
    }
    
    if (applicableLec) {
        return { status: 'IN_LECTURE', lecture: applicableLec };
    }

    // If no specific lecture applies, it's a break for this user
    return { status: 'IN_BREAK', nextLec: nextLecture };
}


// --- UI RENDERING ---
function renderResult(result) {
    const resultText = document.getElementById('result-text');
    const choiceModal = document.getElementById('choice-modal');
    
    choiceModal.classList.add('hidden');
    let html = '';

    switch (result.status) {
        case 'CHOICE_REQUIRED':
            renderChoiceModal(result.options);
            return;
        case 'NO_DIVISION':
            html = `<p class="text-red-500 font-semibold">Please save your details first.</p>`;
            break;
        case 'IN_LECTURE':
            const lec = result.lecture;
            let groupId;
            if (lec.type === 'elective') groupId = lec.electiveGroup;
            else if (lec.type === 'minor') groupId = lec.minorGroup;
            else if (lec.type === 'tutorial') groupId = lec.subject;
            
            const changeButtonHtml = lec.type ? `<button class="text-xs text-red-500 hover:underline ml-2" data-groupid="${groupId}">(Change Choice)</button>` : '';

            html = `
                <div class="text-center">
                    <div class="flex items-center justify-center">
                        <p class="text-lg font-medium">Currently in session:</p>
                        ${changeButtonHtml}
                    </div>
                    <h3 class="text-3xl font-bold text-blue-600 my-1">${lec.subject}</h3>
                    <p class="text-lg text-gray-700">with ${getTeacherName(lec.teacherId)}</p>
                    <p class="text-lg text-gray-700">in Room: <span class="font-semibold">${getRoomInfo(lec.roomId)}</span></p>
                    <p class="text-sm text-gray-500 mt-1">Ends at ${lec.endTime}</p>
                </div>`;
            break;
        case 'FOUND_NEXT':
             html = `
                <div class="text-center">
                    <p class="text-lg font-medium">Your next lecture is:</p>
                    <h3 class="text-3xl font-bold text-green-600 my-1">${result.lecture.subject}</h3>
                    <p class="text-lg text-gray-700">at <span class="font-semibold">${result.lecture.startTime}</span> in Room <span class="font-semibold">${getRoomInfo(result.lecture.roomId)}</span></p>
                </div>`;
            break;
        case 'IN_BREAK':
            html = `
                <div class="text-center">
                    <p class="text-2xl font-bold text-green-600">You have a break!</p>
                    <p class="text-lg text-gray-600 mt-1">Next lecture is at ${result.nextLec.startTime}.</p>
                </div>`;
            break;
        case 'COLLEGE_CLOSED_EARLY':
            html = `<p class="text-lg font-semibold">College hasn't started for you yet. First lecture is at ${result.nextLec.startTime}.</p>`;
            break;
        case 'COLLEGE_CLOSED_LATE':
        case 'NO_MORE_LECTURES':
            html = `<p class="text-lg font-semibold">Your lectures for the day are over. College is closed for you.</p>`;
            break;
        case 'NO_LECTURES_TODAY':
            html = `<p class="text-lg font-semibold">No lectures scheduled for you on this day. Enjoy!</p>`;
            break;
        default:
            html = `<p class="text-gray-500">Could not determine status.</p>`;
    }
    resultText.innerHTML = html;
}

function renderChoiceModal(options) {
    const modal = document.getElementById('choice-modal');
    const title = document.getElementById('choice-title');
    const optionsContainer = document.getElementById('choice-options');
    
    const type = options[0].type;
    let groupId;
    if (type === 'elective') groupId = options[0].electiveGroup;
    else if (type === 'minor') groupId = options[0].minorGroup;
    else if (type === 'tutorial') groupId = options[0].subject;

    title.textContent = `Please select your ${type}:`;
    optionsContainer.innerHTML = '';

    if (type === 'tutorial') {
        const allBatches = new Set(options.flatMap(o => o.batches));
        allBatches.forEach(batch => {
            const button = document.createElement('button');
            button.className = 'w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-md';
            button.textContent = `Tutorial Batch ${batch}`;
            button.onclick = () => handleChoiceSelection(groupId, batch);
            optionsContainer.appendChild(button);
        });
    } else { // Logic for electives/minors
        options.forEach(option => {
            const button = document.createElement('button');
            button.className = 'w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-md';
            const buttonText = option.customGroup ? `${option.subject} (${option.customGroup})` : option.subject;
            const choiceValue = option.customGroup || option.subject;
            button.textContent = buttonText;
            button.onclick = () => handleChoiceSelection(groupId, choiceValue);
            optionsContainer.appendChild(button);
        });

        if (type === 'minor') {
            const noMinorButton = document.createElement('button');
            noMinorButton.className = 'w-full text-left p-3 bg-gray-100 hover:bg-red-100 rounded-md mt-2';
            noMinorButton.textContent = 'I did not take a Minor';
            noMinorButton.onclick = () => handleChoiceSelection(groupId, 'NONE');
            optionsContainer.appendChild(noMinorButton);
        }
    }

    modal.classList.remove('hidden');
}

function handleChoiceSelection(groupId, choiceValue) {
    userDetails.choices = userDetails.choices || {};
    userDetails.choices[groupId] = choiceValue;
    localStorage.setItem('userDetails', JSON.stringify(userDetails));
    
    const result = findLectureStatus(lastQuery.day, lastQuery.time, lastQuery.findNext);
    renderResult(result);
}

// --- EVENT LISTENERS & INITIALIZATION ---
function initializeApp() {
    const setupSection = document.getElementById('setup-section');
    const mainApp = document.getElementById('main-app');
    const divisionSelect = document.getElementById('division-select');
    const labBatchInput = document.getElementById('lab-batch-input');
    const saveDetailsBtn = document.getElementById('save-details-btn');
    const userDetailsDisplay = document.getElementById('user-details-display');
    const changeDetailsBtn = document.getElementById('change-details-btn');
    const resultArea = document.getElementById('result-area');
    
    const currentLecBtn = document.getElementById('current-lec-btn');
    const nextLecBtn = document.getElementById('next-lec-btn');
    const showLecBtn = document.getElementById('show-lec-btn');
    const daySelect = document.getElementById('day-select');
    const timeInput = document.getElementById('time-input');

    const showMainApp = () => {
        setupSection.classList.add('hidden');
        mainApp.classList.remove('hidden');
    };

    const showSetup = () => {
        mainApp.classList.add('hidden');
        setupSection.classList.remove('hidden');
    };

    const saveUserDetails = () => {
        const division = divisionSelect.value;
        if (!division) {
            alert('Please select your division.');
            return;
        }
        const existingChoices = userDetails.choices || {};
        userDetails = {
            division: division,
            labBatch: labBatchInput.value.trim().toUpperCase(),
            choices: existingChoices
        };
        localStorage.setItem('userDetails', JSON.stringify(userDetails));
        updateUserInfoDisplay();
        showMainApp();
    };

    const updateUserInfoDisplay = () => {
        userDetailsDisplay.textContent = `Div: ${userDetails.division} | Lab: ${userDetails.labBatch}`;
    };
    
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach(day => {
        const option = document.createElement('option');
        option.value = day;
        option.textContent = day;
        daySelect.appendChild(option);
    });
    const now = new Date();
    const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
    if (days.includes(dayOfWeek)) daySelect.value = dayOfWeek;
    timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    saveDetailsBtn.addEventListener('click', saveUserDetails);
    changeDetailsBtn.addEventListener('click', showSetup);

    resultArea.addEventListener('click', (event) => {
        if (event.target.dataset.groupid) {
            const groupId = event.target.dataset.groupid;
            delete userDetails.choices[groupId];
            localStorage.setItem('userDetails', JSON.stringify(userDetails));
            const result = findLectureStatus(lastQuery.day, lastQuery.time, lastQuery.findNext);
            renderResult(result);
        }
    });

    currentLecBtn.addEventListener('click', () => {
        const now = new Date();
        const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        lastQuery = { day, time, findNext: false };
        const result = findLectureStatus(day, time, false);
        renderResult(result);
    });

    nextLecBtn.addEventListener('click', () => {
        const now = new Date();
        const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        lastQuery = { day, time, findNext: true };
        const result = findLectureStatus(day, time, true);
        renderResult(result);
    });

    showLecBtn.addEventListener('click', () => {
        const day = daySelect.value;
        const time = timeInput.value;
        lastQuery = { day, time, findNext: false };
        const result = findLectureStatus(day, time, false);
        renderResult(result);
    });

    populateDivisionDropdown();
    const savedDetails = localStorage.getItem('userDetails');
    if (savedDetails) {
        userDetails = JSON.parse(savedDetails);
        divisionSelect.value = userDetails.division;
        labBatchInput.value = userDetails.labBatch;
        updateUserInfoDisplay();
        showMainApp();
    } else {
        showSetup();
    }
}

function populateDivisionDropdown() {
    const divisionSelect = document.getElementById('division-select');
    const allDivisions = new Set(appData.timetable.flatMap(lec => lec.divisions));
    const sortedDivisions = [...allDivisions].sort();

    sortedDivisions.forEach(division => {
        const option = document.createElement('option');
        option.value = division;
        option.textContent = division;
        divisionSelect.appendChild(option);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    if (appData) {
        initializeApp();
    }
});
