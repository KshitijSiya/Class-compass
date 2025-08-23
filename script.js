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
    
    let lecturesToConsider;
    const nextUpcomingLecture = scheduleToday.find(l => time < l.startTime);

    if (findNext) {
        if (!nextUpcomingLecture) return { status: 'NO_MORE_LECTURES' };
        lecturesToConsider = scheduleToday.filter(l => l.startTime === nextUpcomingLecture.startTime);
    } else {
        if (time < personalStartTime) return { status: 'COLLEGE_CLOSED_EARLY', nextLec: scheduleToday[0] };
        if (time > personalEndTime) return { status: 'COLLEGE_CLOSED_LATE' };
        lecturesToConsider = scheduleToday.filter(lec => time >= lec.startTime && time < lec.endTime);
    }

    if (lecturesToConsider.length === 0) {
        return { status: 'IN_BREAK', nextLec: nextUpcomingLecture };
    }

    const choiceLectureGroup = lecturesToConsider.filter(lec => ['tutorial', 'elective', 'minor'].includes(lec.type));
    if (choiceLectureGroup.length > 0) {
        const choiceType = choiceLectureGroup[0].type;
        
        let groupId;
        if (choiceType === 'elective') groupId = `elective_${choiceLectureGroup[0].electiveGroup}`;
        else if (choiceType === 'minor') groupId = `minor_${choiceLectureGroup[0].minorGroup}`;
        else if (choiceType === 'tutorial') groupId = `tutorial_${choiceLectureGroup[0].subject}`;

        const userChoice = userDetails.choices ? userDetails.choices[groupId] : null;

        if (userChoice) {
            if (userChoice === 'NONE') return { status: 'CHOICE_MADE_NONE', groupId: groupId, nextLec: nextUpcomingLecture };
            let applicableLec;
            if (choiceType === 'tutorial') {
                applicableLec = choiceLectureGroup.find(lec => lec.batches.includes(userChoice));
            } else {
                applicableLec = choiceLectureGroup.find(lec => lec.subject === userChoice || lec.customGroup === userChoice);
            }
            if (applicableLec) {
                return { status: findNext ? 'FOUND_NEXT' : 'IN_LECTURE', lecture: applicableLec };
            }
        } else {
            return { status: 'CHOICE_REQUIRED', options: choiceLectureGroup };
        }
    }

    let applicableLec = null;
    applicableLec = lecturesToConsider.find(lec => !lec.type && lec.batches && lec.batches.length === 1 && userDetails.labBatch === lec.batches[0]);
    if (!applicableLec) applicableLec = lecturesToConsider.find(lec => !lec.type && (!lec.batches || lec.batches.length > 1));
    
    if (applicableLec) {
        return { status: findNext ? 'FOUND_NEXT' : 'IN_LECTURE', lecture: applicableLec };
    }

    return { status: 'IN_BREAK', nextLec: nextUpcomingLecture };
}

function findEmptyRooms(day, time, floor = null) {
    const definitelyOccupied = new Set();
    const potentialLectures = [];

    appData.timetable.forEach(lec => {
        if (lec.day === day && time >= lec.startTime && time < lec.endTime) {
            if (lec.roomId.length === 1) {
                definitelyOccupied.add(lec.roomId[0]);
            } else {
                potentialLectures.push(lec);
            }
        }
    });

    const potentialRooms = new Set(potentialLectures.flatMap(lec => lec.roomId));
    let checkableRooms = appData.rooms.filter(room => CHECKABLE_ROOM_IDS.includes(room.id));
    
    let availableRooms = checkableRooms.filter(room => 
        !definitelyOccupied.has(room.id) && !potentialRooms.has(room.id)
    );

    if (floor !== null && floor !== 'all') {
        availableRooms = availableRooms.filter(room => room.floor == floor);
        const filteredPotential = potentialLectures.filter(lec => 
            lec.roomId.some(id => {
                const roomData = appData.rooms.find(r => r.id === id);
                return roomData && roomData.floor == floor;
            })
        );
         return { availableRooms, potentialLectures: filteredPotential };
    }

    return { availableRooms, potentialLectures };
}

function findTeacherLocation(teacherId, day, time) {
    const teacher = appData.teachers.find(t => t.id === teacherId);
    if (!teacher) return { status: 'NOT_FOUND' };
    if (time < "08:00" || time > "17:00") return { status: 'OUTSIDE_HOURS', teacherName: teacher.name };
    const currentLecture = appData.timetable.find(lec => lec.teacherId === teacherId && lec.day === day && time >= lec.startTime && time < lec.endTime);
    if (currentLecture) return { status: 'IN_LECTURE', lecture: currentLecture, teacherName: teacher.name };
    else return { status: 'IN_CABIN', cabin: teacher.cabinRoomId, teacherName: teacher.name };
}

function findRoomStatus(roomId, day, time) {
    const lectureInRoom = appData.timetable.find(lec => lec.day === day && time >= lec.startTime && time < lec.endTime && lec.roomId.includes(roomId));
    if (!lectureInRoom) return { status: 'AVAILABLE' };
    
    if (lectureInRoom.roomId.length > 1) {
        return { status: 'POTENTIALLY_OCCUPIED', lecture: lectureInRoom };
    }
    
    return { status: 'OCCUPIED', lecture: lectureInRoom };
}

// --- UI RENDERING ---
function renderScheduleResult(result) {
    const resultText = document.getElementById('schedule-result-text');
    const choiceModal = document.getElementById('choice-modal');
    choiceModal.classList.add('hidden');
    let html = '';

    const createChangeButton = (lecture) => {
        if (!lecture.type) return '';
        let groupId;
        if (lecture.type === 'elective') groupId = `elective_${lecture.electiveGroup}`;
        else if (lecture.type === 'minor') groupId = `minor_${lecture.minorGroup}`;
        else if (lecture.type === 'tutorial') groupId = `tutorial_${lecture.subject}`;
        return `<button class="text-xs text-red-500 hover:underline ml-2" data-groupid="${groupId}">(Change Choice)</button>`;
    };
    
    switch (result.status) {
        case 'OUTSIDE_HOURS':
            html = `<p class="text-lg font-semibold">College is likely closed at this time.</p>`;
            break;
        case 'CHOICE_REQUIRED':
            renderChoiceModal(result.options);
            return;
        case 'CHOICE_MADE_NONE': {
            const changeButtonHtml = `<button class="text-xs text-red-500 hover:underline ml-2" data-groupid="${result.groupId}">(Change Choice)</button>`;
            html = `<div class="text-center"><p class="text-2xl font-bold text-green-600">You have a break!</p><p class="text-sm text-gray-600 mt-1">Choice saved as 'None'. ${changeButtonHtml}</p>${result.nextLec ? `<p class="text-lg text-gray-600 mt-1">Next lecture is at ${result.nextLec.startTime}.</p>` : ''}</div>`;
            break;
        }
        case 'IN_LECTURE': {
            const lec = result.lecture;
            const changeButtonHtml = createChangeButton(lec);
            html = `<div class="text-center"><div class="flex items-center justify-center"><p class="text-lg font-medium">Result for selected time:</p>${changeButtonHtml}</div><h3 class="text-3xl font-bold text-blue-600 my-1">${lec.subject}</h3><p class="text-lg text-gray-700">with ${getTeacherName(lec.teacherId)}</p><p class="text-lg text-gray-700">in Room: <span class="font-semibold">${getRoomInfo(lec.roomId)}</span></p><p class="text-sm text-gray-500 mt-1">Ends at ${lec.endTime}</p></div>`;
            break;
        }
        case 'FOUND_NEXT': {
            const lec = result.lecture;
            const changeButtonHtml = createChangeButton(lec);
            html = `<div class="text-center"><div class="flex items-center justify-center"><p class="text-lg font-medium">Next lecture is:</p>${changeButtonHtml}</div><h3 class="text-3xl font-bold text-green-600 my-1">${lec.subject}</h3><p class="text-lg text-gray-700">at <span class="font-semibold">${lec.startTime}</span> in Room <span class="font-semibold">${getRoomInfo(lec.roomId)}</span></p></div>`;
            break;
        }
        case 'IN_BREAK':
            html = `<div class="text-center"><p class="text-2xl font-bold text-green-600">You have a break!</p>${result.nextLec ? `<p class="text-lg text-gray-600 mt-1">Next lecture is at ${result.nextLec.startTime}.</p>` : ''}</div>`;
            break;
        case 'COLLEGE_CLOSED_EARLY':
            html = `<p class="text-lg font-semibold">Your first lecture isn't until ${result.nextLec.startTime}.</p>`;
            break;
        case 'COLLEGE_CLOSED_LATE':
            html = `<p class="text-lg font-semibold">Your lectures for the day are over!</p>`;
            break;
        case 'NO_MORE_LECTURES':
             html = `<p class="text-lg font-semibold">No more lectures for you today!</p>`;
             break;
        default:
            html = `<p class="text-lg font-semibold">No lectures scheduled for you at this time.</p>`;
    }
    resultText.innerHTML = html;
}

function renderRoomResult(result, target) {
    const roomResultText = document.getElementById(target);
    let html = '';
    
    if (result.status === 'OUTSIDE_HOURS') {
        html = `<p class="text-lg font-semibold">College is likely closed at this time.</p>`;
    } else if (result.status === 'AVAILABLE') {
        html = `<p>Room is <strong class="text-green-600">Available</strong> at this time.</p>`;
    } else if (result.status === 'OCCUPIED') {
        html = `<p>Room is <strong class="text-red-600">Occupied</strong> by <strong>${result.lecture.divisions.join(', ')}</strong> for <strong>${result.lecture.subject}</strong>.</p>`;
    } else if (result.status === 'POTENTIALLY_OCCUPIED') {
        const otherRooms = result.lecture.roomId.join(', ');
        html = `<p>Room is <strong class="text-yellow-600">Potentially Occupied</strong>.</p><p class="text-sm text-gray-600">It's an option for the <strong>${result.lecture.subject}</strong> lecture (${result.lecture.divisions.join(', ')}), which could be in rooms: ${otherRooms}.</p>`;
    } else if (result.status === 'EMPTY_ROOMS') {
        const { availableRooms, potentialLectures } = result;
        if (availableRooms.length === 0 && potentialLectures.length === 0) {
            html = '<p>No empty or potentially empty rooms found at this time.</p>';
        } else {
            html = '<div class="text-left w-full space-y-3">';
            if (availableRooms.length > 0) {
                 const classrooms = availableRooms.filter(r => r.type === 'Classroom').map(r => r.id).join(', ');
                 const labs = availableRooms.filter(r => r.type === 'Lab').map(r => r.id).join(', ');
                 html += '<div>';
                 html += `<strong class="block text-green-700">Definitely Available:</strong>`;
                 if(classrooms) html += `<p class="text-sm">Classrooms: ${classrooms}</p>`;
                 if(labs) html += `<p class="text-sm">Labs: ${labs}</p>`;
                 html += '</div>';
            }
            if (potentialLectures.length > 0) {
                html += '<div>';
                html += `<strong class="block text-yellow-700">Potentially Available:</strong>`;
                potentialLectures.forEach(lec => {
                    const freeCount = lec.roomId.length - 1;
                    const plural = freeCount > 1 ? 's are' : ' is';
                    html += `<p class="text-sm">One of these is in use for <strong>${lec.subject}</strong>, the other ${freeCount} room${plural} free: ${lec.roomId.join(', ')}</p>`;
                });
                html += '</div>';
            }
            html += '</div>';
        }
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
}

function renderChoiceModal(options) {
    const modal = document.getElementById('choice-modal');
    const title = document.getElementById('choice-title');
    const optionsContainer = document.getElementById('choice-options');
    const type = options[0].type;
    
    let groupId;
    if (type === 'elective') groupId = `elective_${options[0].electiveGroup}`;
    else if (type === 'minor') groupId = `minor_${options[0].minorGroup}`;
    else if (type === 'tutorial') groupId = `tutorial_${options[0].subject}`;

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
        const uniqueOptions = [...new Map(options.map(item => [item.customGroup || item.subject, item])).values()];
        uniqueOptions.forEach(option => {
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
    // --- PWA Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => console.log('Service Worker registered successfully:', registration))
                .catch(error => console.log('Service Worker registration failed:', error));
        });
    }

    // --- Existing App Logic ---
    const setupSection = document.getElementById('setup-section');
    const mainApp = document.getElementById('main-app');
    const divisionSelect = document.getElementById('division-select');
    const labBatchSelect = document.getElementById('lab-batch-select');
    const saveDetailsBtn = document.getElementById('save-details-btn');
    const userDetailsDisplay = document.getElementById('user-details-display');
    const changeDetailsBtn = document.getElementById('change-details-btn');
    const currentLecBtn = document.getElementById('current-lec-btn');
    const nextLecBtn = document.getElementById('next-lec-btn');
    const findEmptyRoomsBtn = document.getElementById('find-empty-rooms-btn');
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
    const roomSelect = document.getElementById('room-select');
    const findRoomStatusBtn = document.getElementById('find-room-status-btn');

    const showMainApp = () => { setupSection.classList.add('hidden'); mainApp.classList.remove('hidden'); };
    const showSetup = () => { mainApp.classList.add('hidden'); setupSection.classList.remove('hidden'); };
    const saveUserDetails = () => {
        const division = divisionSelect.value;
        if (!division) { alert('Please select your division.'); return; }
        if (userDetails.division !== division) {
            userDetails = { division: division, labBatch: labBatchSelect.value, choices: {} };
        } else {
            userDetails.division = division;
            userDetails.labBatch = labBatchSelect.value;
        }
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
        if (time < "08:00" || time > "17:00") {
            renderScheduleResult({ status: 'OUTSIDE_HOURS' });
            return;
        }
        lastQuery = { day, time, findNext: false, source: 'current' };
        const result = findLectureStatus(day, time, false);
        renderScheduleResult(result);
    });

    nextLecBtn.addEventListener('click', () => {
        const { day, time } = getLookupTime();
        if (time < "08:00" || time > "17:00") {
            renderScheduleResult({ status: 'OUTSIDE_HOURS' });
            return;
        }
        lastQuery = { day, time, findNext: true, source: 'next' };
        const result = findLectureStatus(day, time, true);
        renderScheduleResult(result);
    });

    findEmptyRoomsBtn.addEventListener('click', () => {
        const { day, time } = getLookupTime();
        if (time < "08:00" || time > "17:00") {
            renderRoomResult({ status: 'OUTSIDE_HOURS' }, 'room-result-text');
            return;
        }
        const floor = floorSelect.value;
        const result = findEmptyRooms(day, time, floor);
        renderRoomResult({ status: 'EMPTY_ROOMS', ...result }, 'room-result-text');
    });
    
    findRoomStatusBtn.addEventListener('click', () => {
        const { day, time } = getLookupTime();
        if (time < "08:00" || time > "17:00") {
            renderRoomResult({ status: 'OUTSIDE_HOURS' }, 'room-result-text');
            return;
        }
        const roomId = roomSelect.value;
        if (!roomId) return;
        const status = findRoomStatus(roomId, day, time);
        renderRoomResult(status, 'room-result-text');
    });

    findTeacherBtn.addEventListener('click', () => {
        const teacherId = teacherSelect.value;
        if (!teacherId) { renderTeacherResult({ status: 'NOT_FOUND' }); return; }
        const { day, time } = getLookupTime();
        const location = findTeacherLocation(teacherId, day, time);
        renderTeacherResult(location);
    });

    scheduleResultArea.addEventListener('click', (event) => {
        if (event.target.dataset.groupid) {
            const groupId = event.target.dataset.groupid;
            delete userDetails.choices[groupId];
            localStorage.setItem('userDetails', JSON.stringify(userDetails));
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

    checkableRoomsData.sort((a,b) => a.id.localeCompare(b.id)).forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `Room ${room.id}`;
        roomSelect.appendChild(option);
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
