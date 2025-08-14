let appData = null;
let userDetails = {};
let lastQuery = { day: null, time: null, findNext: false, source: null };

// --- CONFIGURATION ---
const CHECKABLE_ROOM_IDS = ["201", "202", "205", "206", "213", "214"];
const ECS_TEACHER_IDS = ["KT", "NK", "RM", "AD", "JA", "ABS", "YP", "AJV"];

// --- DATA LOADING ---
async function loadData() {
    try {
        const [ttResponse, teachersResponse, roomsResponse] = await Promise.all([
            fetch('./timetable.json'), fetch('./teachers.json'), fetch('./rooms.json')
        ]);
        if (!ttResponse.ok || !teachersResponse.ok || !roomsResponse.ok) throw new Error('Data file not found.');
        appData = {
            timetable: await ttResponse.json(),
            teachers: await teachersResponse.json(),
            rooms: await roomsResponse.json()
        };
    } catch (error) {
        console.error("Failed to load data files:", error);
        alert("Error loading data. Please check console.");
    }
}

// --- UTILITY FUNCTIONS ---
const getTeacherName = (id) => appData.teachers.find(t => t.id === id)?.name || id || 'N/A';
const getRoomInfo = (ids) => ids ? ids.join(' or ') : 'N/A';

// --- CORE LOGIC ---
function findLectureStatus(day, time, findNext = false) {
    if (!userDetails.division) return { status: 'NO_DIVISION' };
    const scheduleToday = appData.timetable.filter(lec => lec.divisions.includes(userDetails.division) && lec.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (scheduleToday.length === 0) return { status: 'NO_LECTURES_TODAY' };
    const personalStartTime = scheduleToday[0].startTime;
    const personalEndTime = scheduleToday[scheduleToday.length - 1].endTime;
    if (time < personalStartTime) return { status: 'COLLEGE_CLOSED_EARLY', nextLec: scheduleToday[0] };
    if (time > personalEndTime) return { status: 'COLLEGE_CLOSED_LATE' };

    // --- FIX: Smarter "Next Lecture" Logic ---
    const nextLectures = scheduleToday.filter(lec => time < lec.startTime);
    let nextApplicableLecture = null;
    if (nextLectures.length > 0) {
        const userBatches = [userDetails.labBatch].filter(Boolean);
        nextApplicableLecture = nextLectures.find(lec => !lec.batches || lec.batches.some(b => userBatches.includes(b)));
    }

    if (findNext) {
        return nextApplicableLecture ? { status: 'FOUND_NEXT', lecture: nextApplicableLecture } : { status: 'NO_MORE_LECTURES' };
    }

    const currentLectures = scheduleToday.filter(lec => time >= lec.startTime && time < lec.endTime);
    if (currentLectures.length === 0) return { status: 'IN_BREAK', nextLec: nextApplicableLecture };

    let applicableLec = null;
    const userBatches = [userDetails.labBatch].filter(Boolean);
    applicableLec = currentLectures.find(lec => !lec.type && lec.batches && lec.batches.length === 1 && userDetails.labBatch === lec.batches[0]);
    if (!applicableLec && ['tutorial', 'elective', 'minor'].includes(currentLectures[0].type)) {
        const choiceType = currentLectures[0].type;
        let groupId;
        if (choiceType === 'elective') groupId = currentLectures[0].electiveGroup;
        else if (choiceType === 'minor') groupId = currentLectures[0].minorGroup;
        else if (choiceType === 'tutorial') groupId = currentLectures[0].subject;
        const userChoice = userDetails.choices ? userDetails.choices[groupId] : null;
        if (userChoice) {
            if (userChoice === 'NONE') return { status: 'IN_BREAK', nextLec: nextApplicableLecture };
            if (choiceType === 'tutorial') applicableLec = currentLectures.find(lec => lec.batches.includes(userChoice));
            else applicableLec = currentLectures.find(lec => lec.subject === userChoice || lec.customGroup === userChoice);
        } else return { status: 'CHOICE_REQUIRED', options: currentLectures };
    }
    if (!applicableLec) applicableLec = currentLectures.find(lec => !lec.type && lec.batches && lec.batches.length > 1);
    if (applicableLec) return { status: 'IN_LECTURE', lecture: applicableLec };
    return { status: 'IN_BREAK', nextLec: nextApplicableLecture };
}

function findEmptyRooms(day, time, floor = null) {
    const occupiedRoomIds = new Set();
    appData.timetable.forEach(lec => {
        if (lec.day === day && time >= lec.startTime && time < lec.endTime) lec.roomId.forEach(id => occupiedRoomIds.add(id));
    });
    let checkableRooms = appData.rooms.filter(room => CHECKABLE_ROOM_IDS.includes(room.id));
    let availableRooms = checkableRooms.filter(room => !occupiedRoomIds.has(room.id));
    if (floor !== null && floor !== 'all') availableRooms = availableRooms.filter(room => room.floor == floor);
    return availableRooms;
}

function findTeacherLocation(teacherId, day, time) {
    const teacher = appData.teachers.find(t => t.id === teacherId);
    if (!teacher) return { status: 'NOT_FOUND' };
    if (time < "08:00" || time > "17:00") return { status: 'OUTSIDE_HOURS', teacherName: teacher.name };
    const currentLecture = appData.timetable.find(lec => lec.teacherId === teacherId && lec.day === day && time >= lec.startTime && time < lec.endTime);
    if (currentLecture) return { status: 'IN_LECTURE', lecture: currentLecture, teacherName: teacher.name };
    else return { status: 'IN_CABIN', cabin: teacher.cabinRoomId, teacherName: teacher.name };
}

// --- UI RENDERING ---
function renderScheduleResult(result) {
    const resultText = document.getElementById('schedule-result-text');
    const choiceModal = document.getElementById('choice-modal');
    choiceModal.classList.add('hidden');
    let html = '';
    switch (result.status) {
        case 'CHOICE_REQUIRED': renderChoiceModal(result.options); return;
        case 'IN_LECTURE':
            const lec = result.lecture;
            let groupId;
            if (lec.type === 'elective') groupId = lec.electiveGroup;
            else if (lec.type === 'minor') groupId = lec.minorGroup;
            else if (lec.type === 'tutorial') groupId = lec.subject;
            const changeButtonHtml = lec.type ? `<button class="text-xs text-red-500 hover:underline ml-2" data-groupid="${groupId}">(Change Choice)</button>` : '';
            html = `<div class="text-center"><div class="flex items-center justify-center"><p class="text-lg font-medium">Result for selected time:</p>${changeButtonHtml}</div><h3 class="text-3xl font-bold text-blue-600 my-1">${lec.subject}</h3><p class="text-lg text-gray-700">with ${getTeacherName(lec.teacherId)}</p><p class="text-lg text-gray-700">in Room: <span class="font-semibold">${getRoomInfo(lec.roomId)}</span></p><p class="text-sm text-gray-500 mt-1">Ends at ${lec.endTime}</p></div>`;
            break;
        case 'FOUND_NEXT': html = `<div class="text-center"><p class="text-lg font-medium">Next lecture is:</p><h3 class="text-3xl font-bold text-green-600 my-1">${result.lecture.subject}</h3><p class="text-lg text-gray-700">at <span class="font-semibold">${result.lecture.startTime}</span> in Room <span class="font-semibold">${getRoomInfo(result.lecture.roomId)}</span></p></div>`; break;
        case 'IN_BREAK': html = `<div class="text-center"><p class="text-2xl font-bold text-green-600">You have a break!</p><p class="text-lg text-gray-600 mt-1">Next lecture is at ${result.nextLec.startTime}.</p></div>`; break;
        default: html = `<p class="text-lg font-semibold">No lectures scheduled for you at this time.</p>`;
    }
    resultText.innerHTML = html;
}

function renderRoomResult(rooms) {
    const roomResultText = document.getElementById('rooms-result-text');
    const availableClassrooms = rooms.filter(room => room.type === 'Classroom');
    const availableLabs = rooms.filter(room => room.type === 'Lab');
    let html = '';
    if (availableClassrooms.length === 0 && availableLabs.length === 0) html = '<p>No empty rooms found at this time from the checked list.</p>';
    else {
        html = '<div class="text-left w-full">';
        if (availableClassrooms.length > 0) html += `<div class="mb-2"><strong class="block">Available Classrooms:</strong> ${availableClassrooms.map(r => r.id).join(', ')}</div>`;
        if (availableLabs.length > 0) html += `<div><strong class="block">Available Labs:</strong> ${availableLabs.map(r => r.id).join(', ')}</div>`;
        html += '</div>';
    }
    roomResultText.innerHTML = html;
}

function renderTeacherResult(location) {
    const teacherResultText = document.getElementById('teacher-result-text');
    let html = '';
    if (location.status === 'IN_LECTURE') html = `<p><strong class="font-semibold">${location.teacherName}</strong> is teaching <strong>${location.lecture.subject}</strong> to ${location.lecture.divisions.join(', ')} in Room: <strong>${getRoomInfo(location.lecture.roomId)}</strong>.</p>`;
    else if (location.status === 'IN_CABIN') html = `<p><strong class="font-semibold">${location.teacherName}</strong> is likely in their cabin: <strong>${location.cabin || 'N/A'}</strong>.</p>`;
    else if (location.status === 'OUTSIDE_HOURS') html = `<p><strong class="font-semibold">${location.teacherName}</strong> is likely not in college at this time.</p>`;
    else html = `<p>Please select a teacher to find their location.</p>`;
    teacherResultText.innerHTML = html;
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
    } else {
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
    if (lastQuery.source === 'current') document.getElementById('current-lec-btn').click();
    else if (lastQuery.source === 'next') document.getElementById('next-lec-btn').click();
}

// --- INITIALIZATION ---
function initializeApp() {
    const setupSection = document.getElementById('setup-section');
    const mainApp = document.getElementById('main-app');
    const divisionSelect = document.getElementById('division-select');
    const labBatchSelect = document.getElementById('lab-batch-select'); // Changed from input
    const saveDetailsBtn = document.getElementById('save-details-btn');
    const userDetailsDisplay = document.getElementById('user-details-display');
    const changeDetailsBtn = document.getElementById('change-details-btn');
    const currentLecBtn = document.getElementById('current-lec-btn');
    const nextLecBtn = document.getElementById('next-lec-btn');
    const findRoomsBtn = document.getElementById('find-rooms-btn');
    const floorSelect = document.getElementById('floor-select');
    const teacherSelect = document.getElementById('teacher-select');
    const findTeacherBtn = document.getElementById('find-teacher-btn');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const daySelect = document.getElementById('day-select');
    const timeInput = document.getElementById('time-input');
    const modeRealtime = document.getElementById('mode-realtime');
    const modeManual = document.getElementById('mode-manual');
    const scheduleResultArea = document.getElementById('schedule-result-area');

    const showMainApp = () => { setupSection.classList.add('hidden'); mainApp.classList.remove('hidden'); };
    const showSetup = () => { mainApp.classList.add('hidden'); setupSection.classList.remove('hidden'); };
    const saveUserDetails = () => {
        const division = divisionSelect.value;
        if (!division) { alert('Please select your division.'); return; }
        const existingChoices = userDetails.choices || {};
        userDetails = { division: division, labBatch: labBatchSelect.value, choices: existingChoices };
        localStorage.setItem('userDetails', JSON.stringify(userDetails));
        updateUserInfoDisplay();
        showMainApp();
    };
    const updateUserInfoDisplay = () => { userDetailsDisplay.textContent = `Div: ${userDetails.division} | Lab: ${userDetails.labBatch}`; };
    
    const setTimeToNow = () => {
        const now = new Date();
        const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
        if (dayOfWeek !== 'Sunday') daySelect.value = dayOfWeek;
        timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };

    const updateLookupModeUI = () => {
        const isManual = modeManual.checked;
        daySelect.disabled = !isManual;
        timeInput.disabled = !isManual;
        if (!isManual) setTimeToNow();
    };
    
    const getLookupTime = () => {
        if (modeRealtime.checked) {
            const now = new Date();
            const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
            const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            return { day, time };
        } else {
            return { day: daySelect.value, time: timeInput.value };
        }
    };

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active-tab'));
            button.classList.add('active-tab');
            tabContents.forEach(content => content.classList.add('hidden'));
            document.getElementById(`${button.dataset.tab}-tab`).classList.remove('hidden');
        });
    });

    saveDetailsBtn.addEventListener('click', saveUserDetails);
    changeDetailsBtn.addEventListener('click', showSetup);
    modeRealtime.addEventListener('change', updateLookupModeUI);
    modeManual.addEventListener('change', updateLookupModeUI);

    currentLecBtn.addEventListener('click', () => {
        const { day, time } = getLookupTime();
        lastQuery = { day, time, findNext: false, source: 'current' };
        const result = findLectureStatus(day, time, false);
        renderScheduleResult(result);
    });

    nextLecBtn.addEventListener('click', () => {
        const { day, time } = getLookupTime();
        lastQuery = { day, time, findNext: true, source: 'next' };
        const result = findLectureStatus(day, time, true);
        renderScheduleResult(result);
    });

    findRoomsBtn.addEventListener('click', () => {
        const { day, time } = getLookupTime();
        const floor = floorSelect.value;
        const emptyRooms = findEmptyRooms(day, time, floor);
        renderRoomResult(emptyRooms);
    });

    findTeacherBtn.addEventListener('click', () => {
        const teacherId = teacherSelect.value;
        if (!teacherId) { renderTeacherResult({ status: 'NOT_FOUND' }); return; }
        const { day, time } = getLookupTime();
        const location = findTeacherLocation(teacherId, day, time);
        renderTeacherResult(location);
    });

    // --- FIX: Event listener for "Change Choice" button ---
    scheduleResultArea.addEventListener('click', (event) => {
        if (event.target.dataset.groupid) {
            const groupId = event.target.dataset.groupid;
            delete userDetails.choices[groupId];
            localStorage.setItem('userDetails', JSON.stringify(userDetails));
            // Re-run the last query that triggered the choice
            if (lastQuery.source === 'current') currentLecBtn.click();
            else if (lastQuery.source === 'next') nextLecBtn.click();
        }
    });

    // Populate dropdowns
    const allDivisions = new Set(appData.timetable.flatMap(lec => lec.divisions));
    [...allDivisions].sort().forEach(division => {
        const option = document.createElement('option');
        option.value = division;
        option.textContent = division;
        divisionSelect.appendChild(option);
    });

    const checkableRoomsData = appData.rooms.filter(r => CHECKABLE_ROOM_IDS.includes(r.id));
    const allFloors = new Set(checkableRoomsData.map(room => room.floor));
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Checkable Floors';
    floorSelect.appendChild(allOption);
    [...allFloors].sort((a, b) => a - b).forEach(floor => {
        const option = document.createElement('option');
        option.value = floor;
        option.textContent = `Floor ${floor}`;
        floorSelect.appendChild(option);
    });

    appData.teachers.filter(t => ECS_TEACHER_IDS.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(teacher => {
        const option = document.createElement('option');
        option.value = teacher.id;
        option.textContent = teacher.name;
        teacherSelect.appendChild(option);
    });
    
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach(day => { const option = document.createElement('option'); option.value = day; option.textContent = day; daySelect.appendChild(option); });
    
    // Initial Load
    const savedDetails = localStorage.getItem('userDetails');
    if (savedDetails) {
        userDetails = JSON.parse(savedDetails);
        divisionSelect.value = userDetails.division;
        labBatchSelect.value = userDetails.labBatch;
        updateUserInfoDisplay();
        showMainApp();
    } else {
        showSetup();
    }
    updateLookupModeUI();
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    if (appData) initializeApp();
});
