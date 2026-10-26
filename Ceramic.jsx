#target illustrator

(function () {

    // Thư mục chứa ảnh nguồn đang chờ xử lý
    var IMAGE_FOLDER = "X:/INPUT/CENAMIC_ORNAMNET";
    // Thư mục chứa file template_saved.ai
    var TEMPLATE_FOLDER = "X:/OUTPUT/STO/CERAMIC/template";
    // Thư mục chứa ảnh đã xử lý xong
    var IMAGE_DONE_FOLDER = "X:/OUTPUT/STO/CERAMIC/images_done";
    // Thư mục chứa ảnh bị lỗi (tuỳ chọn)
    var IMAGE_ERROR_FOLDER = "X:/OUTPUT/STO/CERAMIC/image_error";
    // Thư mục chứa các file AI đã lưu
    var OUTPUT_FOLDER = "X:/OUTPUT/STO/CERAMIC/output_ai";
    var OUTPUT_PNG_FOLDER = "X:/OUTPUT/STO/CERAMIC/output_png";

    var MAX_SLOT = 70; // Khung được đánh số từ 1 đến 70
    var OLD_USER_INTERACTION_LEVEL = app.userInteractionLevel;

    try {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

        // 1. Khởi tạo và kiểm tra thư mục (tổ chức theo thangN/D-M-YY)
        var outFolder    = getDatedSubFolder(OUTPUT_FOLDER);
        var outPngFolder = getDatedSubFolder(OUTPUT_PNG_FOLDER);
        var doneFolder   = getDatedSubFolder(IMAGE_DONE_FOLDER);
        var errorFolder  = getDatedSubFolder(IMAGE_ERROR_FOLDER);

        var tmplFolder = new Folder(TEMPLATE_FOLDER);
        if (!tmplFolder.exists) {
            throw new Error("Không tìm thấy thư mục template: " + TEMPLATE_FOLDER);
        }

        var imgFolder = new Folder(IMAGE_FOLDER);
        if (!imgFolder.exists) {
            throw new Error("Không tìm thấy thư mục ảnh nguồn: " + IMAGE_FOLDER);
        }

        // 2. Lấy danh sách file ảnh chờ xử lý
        var files = imgFolder.getFiles(function (f) {
            if (!(f instanceof File)) return false;
            if (f.hidden) return false;
            var cleanBase = stripExt(cleanFileName(f.name));
            if (/-\s*done\s*$/i.test(cleanBase)) return false;
            return /\.(jpg|jpeg|png|tif|tiff|bmp|psd|ai)$/i.test(cleanFileName(f.name));
        });

        if (!files || files.length === 0) {
            alert("Không có ảnh cần xử lý trong folder: " + IMAGE_FOLDER);
            app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
            return;
        }

        // 3. Parse tên file và gom nhóm thành danh sách Job
        var parsedItems = [];
        for (var f = 0; f < files.length; f++) {
            try {
                var info = parseFileName(files[f].name);
                parsedItems.push({
                    file: files[f],
                    info: info
                });
            } catch (errParse) {
                $.writeln("File lỗi tên/định dạng: " + files[f].fsName + " | " + getErrorMessage(errParse));
                moveFileToErrorFolder(files[f], errorFolder);
            }
        }

        var jobs = buildJobsFromParsedItems(parsedItems, errorFolder);

        // Sắp xếp ưu tiên theo số lượng giảm dần, sau đó theo ID
        jobs.sort(function (a, b) {
            if (a.qty !== b.qty) {
                return b.qty - a.qty;
            }
            return String(a.id).localeCompare(String(b.id));
        });

        if (jobs.length === 0) {
            app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
            return;
        }

        // 4. Bắt đầu vòng lặp điền template
        var pendingJobs = jobs.slice();
        var currentSlotIndex = 1;
        var doc = null;
        var currentSheetDoneFiles = [];

        var processedFileCount = 0;
        var placedCopyCount = 0;

        // Mở template trắng đầu tiên
        doc = openTemplate(TEMPLATE_FOLDER);
        if (!doc) {
            throw new Error("Không tìm thấy hoặc không mở được file template_saved.ai trong " + TEMPLATE_FOLDER);
        }

        while (pendingJobs.length > 0) {
            var currentJob = pendingJobs[0];
            var remainQty = currentJob.qty;
            var qtyPlacedThisSheet = 0;

            // Điền các bản sao của job hiện tại vào template cho đến khi hết remainQty hoặc hết slot
            while (remainQty > 0 && currentSlotIndex <= MAX_SLOT) {
                var success = placeJobInSlot(doc, currentSlotIndex, currentJob);
                if (success) {
                    placedCopyCount++;
                    qtyPlacedThisSheet++;
                    remainQty--;
                }
                // Tăng index để đi tiếp sang ô tiếp theo
                currentSlotIndex++;
            }

            if (qtyPlacedThisSheet > 0) {
                for (var e = 0; e < currentJob.entries.length; e++) {
                    queueDoneFileForCurrentSheet(
                        currentSheetDoneFiles,
                        currentJob.entries[e].file,
                        currentJob.entries[e].info,
                        qtyPlacedThisSheet,
                        remainQty
                    );
                }
            }

            // Cập nhật số lượng còn lại. Nếu hết thì chuyển sang job tiếp theo.
            if (remainQty <= 0) {
                pendingJobs.shift();
            } else {
                currentJob.qty = remainQty;
            }

            // Xử lý tràn trang (Pagination): Nếu đã điền đến slot 70
            if (currentSlotIndex > MAX_SLOT) {
                saveAndCloseCurrentSheet(doc, outFolder, currentSheetDoneFiles, doneFolder, outPngFolder);
                processedFileCount += currentSheetDoneFiles.length;

                // Reset biến trạng thái
                currentSheetDoneFiles = [];
                currentSlotIndex = 1;

                // Mở template mới cho các job còn lại
                if (pendingJobs.length > 0) {
                    doc = openTemplate(TEMPLATE_FOLDER);
                    if (!doc) throw new Error("Không mở được template mới.");
                }
            }
        }

        // Lưu trang cuối cùng nếu còn dang dở (nhưng đã hết job)
        if (currentSlotIndex > 1 && doc) {
            removeUnusedSlots(doc, currentSlotIndex, MAX_SLOT);
            saveAndCloseCurrentSheet(doc, outFolder, currentSheetDoneFiles, doneFolder, outPngFolder);
            processedFileCount += currentSheetDoneFiles.length;
        }

        app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
        alert("Hoàn tất! Đã xếp thành công " + placedCopyCount + " sản phẩm Ceramic.");

    } catch (e) {
        try { app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL; } catch (restoreErr) { }
        alert("Đã xảy ra lỗi: " + getErrorMessage(e));
    }

    // =========================================================================
    // CÁC HÀM XỬ LÝ JOB VÀ CHÈN ẢNH THEO LAYER FRONT / BACK
    // =========================================================================

    function openTemplate(templateFolder) {
        var tmplFile = new File(templateFolder + "/template_saved.ai");
        if (tmplFile.exists) {
            return app.open(tmplFile);
        }
        return null;
    }

    /**
     * Gom các file đã parse thành danh sách Job:
     * - 1 side: chèn FRONT, xóa khung trống ở BACK cùng vị trí.
     * - 2 side (không có f1/f2): chèn cùng 1 ảnh vào cả FRONT và BACK cùng vị trí.
     * - 2 side (có f1 và f2 cùng item): ghép f1 vào FRONT, f2 vào BACK cùng vị trí.
     */
    function buildJobsFromParsedItems(parsedItems, errorFolder) {
        var jobs = [];
        var pairMap = {};
        var pairKeys = [];

        for (var i = 0; i < parsedItems.length; i++) {
            var item = parsedItems[i];
            var info = item.info;

            if (info.sides === 1) {
                jobs.push({
                    id: info.id,
                    qty: info.qty,
                    sides: 1,
                    frontFile: item.file,
                    backFile: null,
                    entries: [item]
                });
            } else if (info.sides === 2 && !info.face) {
                jobs.push({
                    id: info.id,
                    qty: info.qty,
                    sides: 2,
                    frontFile: item.file,
                    backFile: item.file,
                    entries: [item]
                });
            } else if (info.sides === 2 && (info.face === "f1" || info.face === "f2")) {
                var key = info.itemKey;
                if (!pairMap[key]) {
                    pairMap[key] = { f1: null, f2: null };
                    pairKeys.push(key);
                }
                pairMap[key][info.face] = item;
            }
        }

        // Xử lý các cặp f1 - f2
        for (var k = 0; k < pairKeys.length; k++) {
            var groupKey = pairKeys[k];
            var pair = pairMap[groupKey];

            if (pair.f1 && pair.f2) {
                jobs.push({
                    id: pair.f1.info.id,
                    qty: pair.f1.info.qty,
                    sides: 2,
                    frontFile: pair.f1.file,
                    backFile: pair.f2.file,
                    entries: [pair.f1, pair.f2]
                });
            } else {
                // Nếu bị lẻ file f1 hoặc f2 mà không có file đi kèm thì chuyển vào thư mục lỗi
                var orphan = pair.f1 || pair.f2;
                $.writeln("Thiếu cặp f1/f2 cho item: " + groupKey + " | File: " + orphan.file.fsName);
                moveFileToErrorFolder(orphan.file, errorFolder);
            }
        }

        return jobs;
    }

    /**
     * Chèn 1 sản phẩm vào vị trí `slotIndex` trên cả 2 layer FRONT và BACK.
     */
    function placeJobInSlot(doc, slotIndex, job) {
        var frontOk = placeImageInLayerSlot(doc, "FRONT", slotIndex, job.frontFile);

        if (job.sides === 1 || !job.backFile) {
            // Sản phẩm 1 side: chỉ xếp vào FRONT, xóa placeholder tương ứng bên BACK
            removeSlotInLayer(doc, "BACK", slotIndex);
            return frontOk;
        } else {
            // Sản phẩm 2 side: xếp vào cả FRONT và BACK tại cùng slotIndex
            var backOk = placeImageInLayerSlot(doc, "BACK", slotIndex, job.backFile);
            return frontOk || backOk;
        }
    }

    /**
     * Tìm đối tượng có tên `slotIndex` trong layer chỉ định (`FRONT` hoặc `BACK`) và chèn/thay thế ảnh.
     */
    function placeImageInLayerSlot(doc, layerName, slotIndex, fileToPlace) {
        if (!fileToPlace) return false;

        var layer = getLayerByName(doc, layerName);
        if (!layer) return false;

        layer.visible = true;
        layer.locked = false;

        var slotName = String(slotIndex);
        var targetItem = findSlotInContainer(layer, slotName);
        if (!targetItem) return false;

        try {
            var centerX = 0, centerY = 0;
            var canCenter = false;
            var newPlaced = null;

            if (targetItem.typename === "PlacedItem") {
                try {
                    var bounds = targetItem.geometricBounds;
                    centerX = (bounds[0] + bounds[2]) / 2;
                    centerY = (bounds[1] + bounds[3]) / 2;
                    canCenter = true;
                } catch (errBounds) {
                    canCenter = false;
                }

                targetItem.file = fileToPlace;
                newPlaced = targetItem;

                newPlaced.width = 3.1 * 72;
                newPlaced.height = 3.1 * 72;

                try { newPlaced.rotate(-90); } catch (rotErr) { }

                if (canCenter) {
                    var imgBounds = newPlaced.geometricBounds;
                    var imgWidth = Math.abs(imgBounds[2] - imgBounds[0]);
                    var imgHeight = Math.abs(imgBounds[1] - imgBounds[3]);
                    newPlaced.position = [centerX - (imgWidth / 2), centerY + (imgHeight / 2)];
                }

                try { newPlaced.embed(); } catch (e) { }

            } else {
                var bounds = targetItem.geometricBounds;
                centerX = (bounds[0] + bounds[2]) / 2;
                centerY = (bounds[1] + bounds[3]) / 2;

                newPlaced = layer.placedItems.add();
                newPlaced.file = fileToPlace;
                newPlaced.name = slotName + "_img";

                try {
                    newPlaced.move(targetItem, ElementPlacement.PLACEBEFORE);
                } catch (moveErr) { }

                newPlaced.width = 3.1 * 72;
                newPlaced.height = 3.1 * 72;

                try { newPlaced.rotate(-90); } catch (rotErr) { }

                var imgBounds = newPlaced.geometricBounds;
                var imgWidth = Math.abs(imgBounds[2] - imgBounds[0]);
                var imgHeight = Math.abs(imgBounds[1] - imgBounds[3]);
                newPlaced.position = [centerX - (imgWidth / 2), centerY + (imgHeight / 2)];

                try { newPlaced.embed(); } catch (e) { }
                try { targetItem.remove(); } catch (e) { }
            }

            return true;

        } catch (e) {
            $.writeln("Lỗi khi chèn ảnh vào layer " + layerName + " slot " + slotName + ": " + e.message);
            return false;
        }
    }

    /**
     * Tìm phần tử theo tên bên trong 1 Layer hoặc GroupItem.
     */
    function findSlotInContainer(container, slotName) {
        try {
            return container.pageItems.getByName(slotName);
        } catch (e) { }

        // Tìm đệ quy nếu các slot được gom trong sub-layer hoặc group
        if (container.layers) {
            for (var i = 0; i < container.layers.length; i++) {
                var foundInSub = findSlotInContainer(container.layers[i], slotName);
                if (foundInSub) return foundInSub;
            }
        }
        if (container.groupItems) {
            for (var g = 0; g < container.groupItems.length; g++) {
                var group = container.groupItems[g];
                if (group.name === slotName) return group;
                try {
                    return group.pageItems.getByName(slotName);
                } catch (errG) { }
            }
        }
        return null;
    }

    function removeSlotInLayer(doc, layerName, slotIndex) {
        var layer = getLayerByName(doc, layerName);
        if (!layer) return;
        layer.visible = true;
        layer.locked = false;

        var item = findSlotInContainer(layer, String(slotIndex));
        if (item) {
            try { item.remove(); } catch (e) { }
        }
    }

    function removeUnusedSlots(doc, startSlot, maxSlot) {
        for (var i = startSlot; i <= maxSlot; i++) {
            removeSlotInLayer(doc, "FRONT", i);
            removeSlotInLayer(doc, "BACK", i);
        }
    }

    // =========================================================================
    // CÁC HÀM LƯU FILE, PARSE TÊN FILE VÀ TIỆN ÍCH HỖ TRỢ
    // =========================================================================

    function saveAndCloseCurrentSheet(doc, outFolder, currentSheetDoneFiles, doneFolder, outPngFolder) {
        var baseName = makeTimeFileName();
        var outFile = uniqueAiFile(outFolder, baseName);

        var opts = new IllustratorSaveOptions();
        opts.compatibility = Compatibility.ILLUSTRATOR17;
        opts.pdfCompatible = true;

        doc.selection = null;
        doc.saveAs(outFile, opts);

        // Xuất 2 file PNG mặt trước và mặt sau
        try {
            var layerEye = getLayerByName(doc, "EYE");
            var layerFront = getLayerByName(doc, "FRONT");
            var layerBack = getLayerByName(doc, "BACK");

            if (layerEye) layerEye.visible = false;

            // Xuất ảnh mặt trước
            if (layerFront) layerFront.visible = true;
            if (layerBack) layerBack.visible = false;
            exportPNG(doc, outPngFolder, stripExt(outFile.name) + "_FRONT.png");

            // Xuất ảnh mặt sau
            if (layerFront) layerFront.visible = false;
            if (layerBack) layerBack.visible = true;
            exportPNG(doc, outPngFolder, stripExt(outFile.name) + "_BACK.png");
        } catch (pngErr) {
            $.writeln("Lỗi khi xuất PNG: " + getErrorMessage(pngErr));
        }

        doc.close(SaveOptions.DONOTSAVECHANGES);

        // Xử lý các file nguồn sau khi sheet đã được lưu an toàn
        processQueuedDoneFiles(currentSheetDoneFiles, doneFolder);
    }

    function queueDoneFileForCurrentSheet(queueArray, file, info, doneQty, remainQty) {
        var key = file.fsName;
        for (var i = 0; i < queueArray.length; i++) {
            if (queueArray[i].file.fsName === key) {
                queueArray[i].doneQty += doneQty;
                queueArray[i].remainQty = remainQty;
                return;
            }
        }
        queueArray.push({
            file: file,
            info: info,
            doneQty: doneQty,
            remainQty: remainQty
        });
    }

    function processQueuedDoneFiles(queueArray, doneFolder) {
        for (var i = 0; i < queueArray.length; i++) {
            try {
                moveFileToDoneFolder(queueArray[i], doneFolder);
            } catch (e) {
                $.writeln("Move done thất bại: " + getErrorMessage(e));
            }
        }
    }

    function moveFileToDoneFolder(doneItem, doneFolder) {
        var file = doneItem.file;
        if (!file || !file.exists) return;

        var info = doneItem.info;
        var remainQty = doneItem.remainQty;
        var finalQty = doneItem.doneQty;

        var ext = getExt(cleanFileName(file.name));
        var doneName = buildFileNameWithQty(info, finalQty, ext);
        var dest = uniqueFileInFolder(doneFolder, doneName);

        var copied = file.copy(dest);
        if (remainQty > 0 && copied) {
            renameFileQty(file, info, remainQty);
        } else if (copied) {
            file.remove();
        }
    }

    function renameFileQty(file, info, remainQty) {
        try {
            var ext = getExt(cleanFileName(file.name));
            var newName = buildFileNameWithQty(info, remainQty, ext);
            var target = new File(file.parent.fsName + "/" + newName);
            var n = 2;
            while (target.exists) {
                newName = buildFileNameWithQty(info, remainQty, ext, n);
                target = new File(file.parent.fsName + "/" + newName);
                n++;
            }
            file.rename(newName);
        } catch (e) { }
    }

    function moveFileToErrorFolder(file, errorFolder) {
        try {
            if (!file.exists) return;
            var dest = uniqueFileInFolder(errorFolder, cleanFileName(file.name));
            if (file.copy(dest)) file.remove();
        } catch (e) { }
    }

    function buildFileNameWithQty(info, qty, ext, suffix) {
        var name = "";

        if (info && info.base) {
            if (/(qty[\s_-]*)\d+/i.test(info.base)) {
                name = info.base.replace(/(qty[\s_-]*)\d+/i, "$1" + qty);
            } else {
                name = info.base;
            }
        } else {
            name = info.id + "_qty_" + qty;
        }

        if (suffix && suffix > 1) name += " (" + suffix + ")";
        return name + ext;
    }

    /**
     * Đọc thông tin từ tên file theo chuẩn:
     * Ví dụ:
     * - FBM_89082_item1_circle-ceramic-ornament-2-side-printed-coer_qty_1.png
     * - FBM_89083_item1_circle-ceramic-ornament-2-side-printed-coer_qty_1_f1_CER356.1.png
     * - FBM_89083_item1_circle-ceramic-ornament-2-side-printed-coer_qty_1_f2_CER356.png
     * - FBM_89084_item1_circle-ceramic-ornament-1-side-printed-coer_qty_1.png
     */
    function parseFileName(fileName) {
        var cleanName = cleanFileName(fileName);
        var base = stripExt(cleanName);

        // 1. Nhận diện 1 side hay 2 side
        var sides = 0;
        if (/(?:^|[\s_-])1[\s_-]*side(?:$|[\s_-])/i.test(base)) { sides = 1; } else if (/(?:^|[\s_-])2[\s_-]*side(?:$|[\s_-])/i.test(base)) {
            sides = 2;
        } else {
            throw new Error("Không tìm thấy thông tin '1-side' hoặc '2-side' trong tên file: " + fileName);
        }

        // 2. Nhận diện số lượng (qty_1, qty-1, ...)
        var qty = 1;
        var qtyMatch = base.match(/qty[\s_-]*(\d+)/i);
        if (qtyMatch) {
            qty = parseInt(qtyMatch[1], 10);
        }
        if (isNaN(qty) || qty < 1) {
            throw new Error("Số lượng (qty) không hợp lệ trong tên file: " + fileName);
        }

        // 3. Nhận diện ký hiệu mặt f1 hoặc f2 (nếu có)
        var face = null;
        var faceMatch = base.match(/(?:^|[\s_-])(f1|f2)(?:$|[\s_.-])/i);
        if (faceMatch) {
            face = faceMatch[1].toLowerCase();
        }

        // 4. Trích xuất itemKey để ghép cặp chính xác f1 và f2 của cùng 1 item
        // Ưu tiên lấy cụm <MãĐơn>_item<Số> (ví dụ: FBM_89083_item1), nếu không có thì lấy phần tên trước _f1/_f2
        var itemMatch = base.match(/^(.+?_item\d+)(?:_|$)/i);
        var itemKey = "";
        if (itemMatch) {
            itemKey = itemMatch[1].toLowerCase();
        } else {
            itemKey = base.replace(/[\s_-]+(f1|f2)([\s_.-].*)?$/i, "").toLowerCase();
        }

        var id = itemMatch ? itemMatch[1] : base;

        return {
            id: id,
            itemKey: itemKey,
            sides: sides,
            face: face,
            qty: qty,
            base: base
        };
    }

    function makeTimeFileName() {
        var d = new Date();
        return (d.getMonth() + 1) + "_" + d.getDate() + "_" + pad2(d.getHours()) + "_" + pad2(d.getMinutes()) + "_" + pad2(d.getSeconds());
    }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }
    function cleanFileName(name) {
        var s = String(name);
        try { s = decodeURI(s); } catch (e) { }
        s = s.replace(/%20/g, " ");
        return s;
    }
    function stripExt(name) {
        return String(name).replace(/\.(png|jpg|jpeg|tif|tiff|bmp|psd|ai)(\.(png|jpg|jpeg|tif|tiff|bmp|psd|ai))*$/i, "");
    }
    function getExt(name) { var m = String(name).match(/(\.[^\.]+)$/); return m ? m[1] : ""; }
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function getErrorMessage(e) { return e && e.message ? e.message : String(e); }

    function uniqueAiFile(folder, baseName) {
        var f = new File(folder.fsName + "/" + baseName + ".ai");
        var n = 2;
        while (f.exists) {
            f = new File(folder.fsName + "/" + baseName + " (" + n + ").ai");
            n++;
        }
        return f;
    }

    function uniqueFileInFolder(folder, fileName) {
        var base = stripExt(fileName);
        var ext = getExt(fileName);
        var f = new File(folder.fsName + "/" + fileName);
        var n = 2;
        while (f.exists) {
            f = new File(folder.fsName + "/" + base + " (" + n + ")" + ext);
            n++;
        }
        return f;
    }

    function getDatedSubFolder(basePath) {
        var d = new Date();
        var month = d.getMonth() + 1;
        var day   = d.getDate();
        var year  = String(d.getFullYear()).slice(-2);

        var base = new Folder(basePath);
        if (!base.exists) base.create();

        var monthFolder = new Folder(base.fsName + "/thang" + month);
        if (!monthFolder.exists) monthFolder.create();

        var dayStr    = day + "-" + month + "-" + year;
        var dayFolder = new Folder(monthFolder.fsName + "/" + dayStr);
        if (!dayFolder.exists) dayFolder.create();

        return dayFolder;
    }

    function getLayerByName(doc, name) {
        try {
            return doc.layers.getByName(name);
        } catch (e) {
            return null;
        }
    }

    function exportPNG(doc, folder, fileName) {
        var destFile = new File(folder.fsName + "/" + fileName);
        var exportOpts = new ExportOptionsPNG24();
        exportOpts.transparency = true;
        exportOpts.antiAliasing = true;
        exportOpts.artBoardClipping = true;

        var targetPPI = 300;
        var scalePercent = (targetPPI / 72.0) * 100.0;

        exportOpts.horizontalScale = scalePercent;
        exportOpts.verticalScale = scalePercent;

        doc.exportFile(destFile, ExportType.PNG24, exportOpts);
    }
})();
